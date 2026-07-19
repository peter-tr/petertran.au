import { randomUUID } from "node:crypto";
import { ddb, TABLE_NAME, PK } from "../lib/aws/ddb";
import { normalizeItemName, normalizeUnit } from "../lib/util/normalize";
import { UNKNOWN_DEBUG_INFO, type LastKnownPrice } from "./inventory";
import { DynamoRepository } from "./dynamo-repository";

const SHOPLIST_PREFIX = "SHOPLIST#";

export interface ShoppingListEntry {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  note: string | null;
  isStaple: boolean;
  category: string | null;
  recipeTag: string | null;
  urgent: boolean;
  trackPrice: boolean;
  lastKnownPrice: LastKnownPrice | null;
  addedAt: string;
}

export interface UpdateShoppingListEntryInput {
  name?: string;
  quantity?: number | null;
  unit?: string | null;
  note?: string | null;
  isStaple?: boolean;
  category?: string | null;
  recipeTag?: string | null;
  urgent?: boolean;
  trackPrice?: boolean;
}

// Backfills fields added after some rows were already written. Critical
// for isStaple specifically - a missing non-nullable field fails the
// whole containing list, not just that one row, since GraphQL
// null-propagates a non-null violation up to the nearest nullable
// ancestor (see inventory.ts's withInventoryDefaults for the identical
// situation).
function withShoppingListDefaults(entry: ShoppingListEntry): ShoppingListEntry {
  return {
    ...entry,
    quantity: entry.quantity ?? null,
    unit: entry.unit ?? null,
    note: entry.note ?? null,
    isStaple: entry.isStaple ?? false,
    category: entry.category ?? null,
    recipeTag: entry.recipeTag ?? null,
    urgent: entry.urgent ?? false,
    trackPrice: entry.trackPrice ?? false,
    lastKnownPrice: entry.lastKnownPrice
      ? { ...entry.lastKnownPrice, debugInfo: entry.lastKnownPrice.debugInfo ?? UNKNOWN_DEBUG_INFO }
      : null,
  };
}

class ShoppingListRepository extends DynamoRepository<ShoppingListEntry> {
  constructor() {
    super({ ddb, tableName: TABLE_NAME, pk: PK, skPrefix: SHOPLIST_PREFIX, itemType: "SHOPLIST" });
  }

  protected applyDefaults(entry: ShoppingListEntry): ShoppingListEntry {
    return withShoppingListDefaults(entry);
  }
}

const shoppingListRepository = new ShoppingListRepository();

export async function getShoppingListEntry(id: string): Promise<ShoppingListEntry | null> {
  return shoppingListRepository.get(id);
}

// Exported for the digest Lambda (lib/aws/send-digest.ts), which needs the
// same query outside of any GraphQL resolver context.
export async function getShoppingList(): Promise<ShoppingListEntry[]> {
  return shoppingListRepository.getAll();
}

export async function putShoppingListEntry(entry: ShoppingListEntry): Promise<void> {
  return shoppingListRepository.put(entry);
}

export async function deleteShoppingListEntry(id: string): Promise<boolean> {
  return shoppingListRepository.delete(id);
}

// Called only by the price-check Lambda (lib/anthropic/check-prices.ts), not
// exposed as a GraphQL mutation - mirrors inventory.ts's setLastKnownPrice.
export async function setShoppingListLastKnownPrice(id: string, price: LastKnownPrice): Promise<void> {
  const existing = await getShoppingListEntry(id);
  if (!existing) throw new Error(`No shopping list entry found with id "${id}".`);

  await putShoppingListEntry({ ...existing, lastKnownPrice: price });
}

// Used both automatically (a staple running out), manually (the "add to
// shopping list" form), and by the AI command bar (plain commands and
// missing recipe ingredients) - updates the existing entry's
// quantity/unit/note rather than duplicating one for the same normalized
// name, if one's already there.
export async function upsertShoppingListEntry(
  name: string,
  quantity: number | null,
  unit: string | null,
  note: string | null = null,
  isStaple = false,
  category: string | null = null,
  recipeTag: string | null = null,
  urgent = false
): Promise<ShoppingListEntry> {
  const normalizedUnit = unit ? normalizeUnit(unit) : null;
  const existing = await getShoppingList();
  const needle = normalizeItemName(name);
  const match = existing.find((e) => normalizeItemName(e.name) === needle);

  const entry: ShoppingListEntry = match
    ? {
        ...match,
        quantity: quantity ?? match.quantity,
        unit: normalizedUnit ?? match.unit,
        note: note ?? match.note,
        category: category ?? match.category,
        recipeTag: recipeTag ?? match.recipeTag,
        // Only ever upgrades to true, never back to false - an unrelated
        // manual add shouldn't undo an earlier staple/urgent-triggered one.
        isStaple: isStaple || match.isStaple,
        urgent: urgent || match.urgent,
      }
    : {
        id: randomUUID(),
        name,
        quantity,
        unit: normalizedUnit,
        note,
        isStaple,
        category,
        recipeTag,
        urgent,
        trackPrice: false,
        lastKnownPrice: null,
        addedAt: new Date().toISOString(),
      };

  await putShoppingListEntry(entry);

  return entry;
}
