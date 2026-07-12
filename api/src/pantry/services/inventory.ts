import { randomUUID } from "node:crypto";
import { QueryCommand, GetCommand, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME, PK } from "../lib/aws/ddb";
import { normalizeUnit } from "../lib/util/normalize";
import type { AiCallDebugInfo } from "../lib/anthropic/debug-info";

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
export const UNKNOWN_DEBUG_INFO: AiCallDebugInfo = { costUsd: 0, durationMs: 0, searchesUsed: 0, fetchesUsed: 0 };

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

export async function getItem(id: string): Promise<InventoryItem | null> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { pk: PK, sk: `${ITEM_PREFIX}${id}` } })
  );
  const item = res.Item?.data as InventoryItem | undefined;
  return item ? withInventoryDefaults(item) : null;
}

export async function getAllItems(): Promise<InventoryItem[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":pk": PK, ":prefix": ITEM_PREFIX },
    })
  );
  return (res.Items ?? []).map((i) => withInventoryDefaults(i.data as InventoryItem));
}

export async function putItem(item: InventoryItem): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { pk: PK, sk: `${ITEM_PREFIX}${item.id}`, type: "ITEM", data: item },
    })
  );
}

export async function deleteItem(id: string): Promise<boolean> {
  const res = await ddb.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { pk: PK, sk: `${ITEM_PREFIX}${id}` },
      ReturnValues: "ALL_OLD",
    })
  );
  return res.Attributes !== undefined;
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
