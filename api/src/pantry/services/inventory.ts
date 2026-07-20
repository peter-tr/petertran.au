import { randomUUID } from "node:crypto";
import { ddb, TABLE_NAME, PK } from "../lib/aws/ddb";
import { normalizeItemName, normalizeUnit } from "../lib/util/normalize";
import type { AiCallDebugInfo } from "../lib/anthropic/debug-info";
import { DynamoRepository } from "./dynamo-repository";

const ITEM_PREFIX = "ITEM#";

export interface Purchase {
  date: string;
  price: number | null;
  quantity: number;
}

export interface LastKnownPrice {
  colesPrice: number | null;
  productUrl: string | null;
  note: string | null;
  checkedAt: string;
  debugInfo: AiCallDebugInfo;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: string | null;
  location: "FRIDGE" | "FREEZER" | "PANTRY";
  quantity: number;
  unit: string | null;
  price: number | null;
  purchasedAt: string | null;
  expiresAt: string | null;
  isStaple: boolean;
  lowPriority: boolean;
  nearlyEmpty: boolean;
  trackPrice: boolean;
  lastKnownPrice: LastKnownPrice | null;
  purchases: Purchase[];
  addedAt: string;
  updatedAt: string;
}

export interface AddInventoryItemInput {
  name: string;
  category?: string | null;
  location: InventoryItem["location"];
  quantity: number;
  unit?: string | null;
  price?: number | null;
  purchasedAt?: string | null;
  expiresAt?: string | null;
  isStaple?: boolean | null;
  lowPriority?: boolean | null;
  nearlyEmpty?: boolean | null;
  trackPrice?: boolean | null;
}

export type UpdateInventoryItemInput = Partial<Omit<AddInventoryItemInput, "location">> & {
  location?: InventoryItem["location"];
};

// A price row written before debugInfo existed - zeros read as "unknown",
// not "free/instant", but that's preferable to the alternative: debugInfo
// is non-null in the schema, so leaving it missing would null-propagate the
// whole lastKnownPrice field back to the client (see this file's
// withInventoryDefaults comment), silently hiding an already-confirmed price.
export const UNKNOWN_DEBUG_INFO: AiCallDebugInfo = {
  costUsd: 0,
  durationMs: 0,
  searchesUsed: 0,
  fetchesUsed: 0,
};

// Backfills fields added after some rows were already written - critical
// for lowPriority/isStaple/nearlyEmpty specifically, since they're
// non-nullable: a missing value on even one row would fail the whole
// inventory query, not just that row (see withShoppingListDefaults's
// identical comment - this is the same class of bug, on the more
// heavily-populated type).
function withInventoryDefaults(item: InventoryItem): InventoryItem {
  return {
    ...item,
    isStaple: item.isStaple ?? false,
    lowPriority: item.lowPriority ?? false,
    nearlyEmpty: item.nearlyEmpty ?? false,
    trackPrice: item.trackPrice ?? false,
    lastKnownPrice: item.lastKnownPrice
      ? { ...item.lastKnownPrice, debugInfo: item.lastKnownPrice.debugInfo ?? UNKNOWN_DEBUG_INFO }
      : null,
  };
}

class InventoryRepository extends DynamoRepository<InventoryItem> {
  constructor() {
    super({ ddb, tableName: TABLE_NAME, pk: PK, skPrefix: ITEM_PREFIX, itemType: "ITEM" });
  }

  protected applyDefaults(item: InventoryItem): InventoryItem {
    return withInventoryDefaults(item);
  }
}

const inventoryRepository = new InventoryRepository();

export async function getItem(id: string): Promise<InventoryItem | null> {
  return inventoryRepository.get(id);
}

export async function getAllItems(): Promise<InventoryItem[]> {
  return inventoryRepository.getAll();
}

export async function putItem(item: InventoryItem): Promise<void> {
  return inventoryRepository.put(item);
}

export async function deleteItem(id: string): Promise<boolean> {
  return inventoryRepository.delete(id);
}

// Called only by the price-check Lambda (lib/anthropic/check-prices.ts), not
// exposed as a GraphQL mutation - lastKnownPrice is system-written, never
// something a user (or the AI command bar) can set directly.
export async function setLastKnownPrice(id: string, price: LastKnownPrice): Promise<void> {
  const existing = await getItem(id);
  if (!existing) throw new Error(`No inventory item found with id "${id}".`);

  await putItem({ ...existing, lastKnownPrice: price });
}

export function createItem(input: AddInventoryItemInput): InventoryItem {
  const now = new Date().toISOString();
  const purchasedAt = input.purchasedAt ?? null;

  return {
    id: randomUUID(),
    name: input.name,
    category: input.category ?? null,
    location: input.location,
    quantity: input.quantity,
    unit: normalizeUnit(input.unit),
    price: input.price ?? null,
    purchasedAt,
    expiresAt: input.expiresAt ?? null,
    isStaple: input.isStaple ?? false,
    lowPriority: input.lowPriority ?? false,
    nearlyEmpty: input.nearlyEmpty ?? false,
    trackPrice: input.trackPrice ?? false,
    lastKnownPrice: null,
    // Only log an initial purchase batch if a date was actually given - no
    // point fabricating one for a bare-minimum add.
    purchases: purchasedAt
      ? [{ date: purchasedAt, price: input.price ?? null, quantity: input.quantity }]
      : [],
    addedAt: now,
    updatedAt: now,
  };
}

// Pure merge rules for folding a purchase into an already-existing item -
// exported so dev/dev-resolvers.ts's in-memory mock can share this instead
// of reimplementing the same arithmetic against its own Map-backed store.
export function mergePurchaseIntoItem(existing: InventoryItem, input: AddInventoryItemInput): InventoryItem {
  const purchasedAt = input.purchasedAt ?? null;

  return {
    ...existing,
    quantity: existing.quantity + input.quantity,
    purchasedAt:
      purchasedAt && (!existing.purchasedAt || purchasedAt > existing.purchasedAt)
        ? purchasedAt
        : existing.purchasedAt,
    price: input.price ?? existing.price,
    purchases: purchasedAt
      ? [...existing.purchases, { date: purchasedAt, price: input.price ?? null, quantity: input.quantity }]
      : existing.purchases,
    updatedAt: new Date().toISOString(),
  };
}

// Looks up an existing item by normalized name + location and merges the
// purchase into it, or creates a new item if there's no match - mirrors
// shopping-list.ts's upsertShoppingListEntry (lookup + merge + persist
// lives in the service, not the resolver).
export async function recordPurchase(input: AddInventoryItemInput): Promise<InventoryItem> {
  const needle = normalizeItemName(input.name);
  const all = await getAllItems();
  const existing = all.find((i) => i.location === input.location && normalizeItemName(i.name) === needle);

  if (!existing) {
    const item = createItem(input);
    await putItem(item);

    return item;
  }

  const updated = mergePurchaseIntoItem(existing, input);
  await putItem(updated);

  return updated;
}
