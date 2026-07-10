import { randomUUID } from "node:crypto";
import { QueryCommand, GetCommand, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME, PK } from "../lib/aws/ddb";
import { assertNotRateLimited } from "../lib/util/rate-limit";
import { normalizeItemName, normalizeUnit } from "../lib/util/normalize";
import { parseCommand, type ParsedCommandResult } from "../lib/anthropic/parse-command";
import type { Context } from "../context";

const ITEM_PREFIX = "ITEM#";
const SHOPLIST_PREFIX = "SHOPLIST#";
const SETTINGS_SK = "SETTINGS";

export interface Purchase {
  date: string;
  price: number | null;
  quantity: number;
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
  purchases: Purchase[];
  addedAt: string;
  updatedAt: string;
}

export interface ShoppingListEntry {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  note: string | null;
  isStaple: boolean;
  addedAt: string;
}

export interface PantrySettings {
  view: string;
  sort: string;
  simple: boolean;
  optionsCollapsed: boolean;
  collapsedGroups: string[];
  commonItems: string[];
  shoppingListCollapsed: boolean;
}

interface PantrySettingsInput {
  view?: string;
  sort?: string;
  simple?: boolean;
  optionsCollapsed?: boolean;
  collapsedGroups?: string[];
  commonItems?: string[];
  shoppingListCollapsed?: boolean;
}

// Same starting list as the client used to seed localStorage with, so the
// very first request (before anyone has ever saved settings) behaves the
// same as before this was moved server-side.
const DEFAULT_SETTINGS: PantrySettings = {
  view: "location",
  sort: "recent",
  simple: false,
  optionsCollapsed: false,
  collapsedGroups: [],
  shoppingListCollapsed: false,
  commonItems: [
    "Milk",
    "Eggs",
    "Bread",
    "Butter",
    "Cheese",
    "Chicken breast",
    "Rice",
    "Pasta",
    "Onions",
    "Tomatoes",
    "Bananas",
    "Apples",
    "Yoghurt",
    "Coffee",
  ],
};

interface AddInventoryItemInput {
  name: string;
  category?: string | null;
  location: InventoryItem["location"];
  quantity: number;
  unit?: string | null;
  price?: number | null;
  purchasedAt?: string | null;
  expiresAt?: string | null;
  isStaple?: boolean | null;
}

type UpdateInventoryItemInput = Partial<Omit<AddInventoryItemInput, "location">> & {
  location?: InventoryItem["location"];
};

async function getItem(id: string): Promise<InventoryItem | null> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { pk: PK, sk: `${ITEM_PREFIX}${id}` } })
  );
  return (res.Item?.data as InventoryItem | undefined) ?? null;
}

async function getAllItems(): Promise<InventoryItem[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":pk": PK, ":prefix": ITEM_PREFIX },
    })
  );
  return (res.Items ?? []).map((i) => i.data as InventoryItem);
}

async function putItem(item: InventoryItem): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { pk: PK, sk: `${ITEM_PREFIX}${item.id}`, type: "ITEM", data: item },
    })
  );
}

function createItem(input: AddInventoryItemInput): InventoryItem {
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
    // Only log an initial purchase batch if a date was actually given - no
    // point fabricating one for a bare-minimum add.
    purchases: purchasedAt
      ? [{ date: purchasedAt, price: input.price ?? null, quantity: input.quantity }]
      : [],
    addedAt: now,
    updatedAt: now,
  };
}

async function getShoppingList(): Promise<ShoppingListEntry[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":pk": PK, ":prefix": SHOPLIST_PREFIX },
    })
  );
  // Backfills fields added after some rows were already written. Critical
  // for isStaple specifically - a missing non-nullable field fails the
  // whole list, not just that one row, since GraphQL null-propagates a
  // non-null violation up to the nearest nullable ancestor (the array).
  return (res.Items ?? []).map((i) => {
    const entry = i.data as ShoppingListEntry;
    return {
      ...entry,
      quantity: entry.quantity ?? null,
      unit: entry.unit ?? null,
      note: entry.note ?? null,
      isStaple: entry.isStaple ?? false,
    };
  });
}

// Used both automatically (a staple running out), manually (the "add to
// shopping list" form), and by the AI command bar (plain commands and
// missing recipe ingredients) - updates the existing entry's
// quantity/unit/note rather than duplicating one for the same normalized
// name, if one's already there.
async function upsertShoppingListEntry(
  name: string,
  quantity: number | null,
  unit: string | null,
  note: string | null = null,
  isStaple = false
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
        // Only ever upgrades to true, never back to false - an unrelated
        // manual add shouldn't undo an earlier staple-triggered one.
        isStaple: isStaple || match.isStaple,
      }
    : {
        id: randomUUID(),
        name,
        quantity,
        unit: normalizedUnit,
        note,
        isStaple,
        addedAt: new Date().toISOString(),
      };

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { pk: PK, sk: `${SHOPLIST_PREFIX}${entry.id}`, type: "SHOPLIST", data: entry },
    })
  );
  return entry;
}

// Merges with DEFAULT_SETTINGS rather than only falling back when nothing's
// stored at all - a settings row saved before a new field (like `sort`) was
// added would otherwise come back missing it, tripping the schema's
// non-null check instead of just quietly defaulting.
async function getSettings(): Promise<PantrySettings> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: PK, sk: SETTINGS_SK } }));
  return { ...DEFAULT_SETTINGS, ...(res.Item?.data as Partial<PantrySettings> | undefined) };
}

async function putSettings(settings: PantrySettings): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { pk: PK, sk: SETTINGS_SK, type: "SETTINGS", data: settings },
    })
  );
}

export const resolvers = {
  Query: {
    inventory: async (
      _: unknown,
      args: { location?: InventoryItem["location"] }
    ): Promise<InventoryItem[]> => {
      let items = await getAllItems();
      if (args.location) {
        items = items.filter((i) => i.location === args.location);
      }
      return items.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    },
    inventoryItem: (_: unknown, args: { id: string }) => getItem(args.id),
    shoppingList: async (): Promise<ShoppingListEntry[]> => {
      const entries = await getShoppingList();
      return entries.sort((a, b) => a.addedAt.localeCompare(b.addedAt));
    },
    settings: (): Promise<PantrySettings> => getSettings(),
    parseCommand: async (
      _: unknown,
      args: { input: string; history?: { role: string; content: string }[] },
      context: Context
    ): Promise<ParsedCommandResult> => {
      const [inventory, shoppingList] = await Promise.all([getAllItems(), getShoppingList()]);
      return parseCommand(args.input, args.history ?? [], inventory, shoppingList, context.sourceIp);
    },
  },
  Mutation: {
    addInventoryItem: async (
      _: unknown,
      args: { input: AddInventoryItemInput },
      context: Context
    ): Promise<InventoryItem> => {
      await assertNotRateLimited(context.sourceIp);
      const item = createItem(args.input);
      await putItem(item);
      return item;
    },

    recordPurchase: async (
      _: unknown,
      args: { input: AddInventoryItemInput },
      context: Context
    ): Promise<InventoryItem> => {
      await assertNotRateLimited(context.sourceIp);

      const needle = normalizeItemName(args.input.name);
      const all = await getAllItems();
      const existing = all.find(
        (i) => i.location === args.input.location && normalizeItemName(i.name) === needle
      );

      if (!existing) {
        const item = createItem(args.input);
        await putItem(item);
        return item;
      }

      const purchasedAt = args.input.purchasedAt ?? null;
      const updated: InventoryItem = {
        ...existing,
        quantity: existing.quantity + args.input.quantity,
        purchasedAt:
          purchasedAt && (!existing.purchasedAt || purchasedAt > existing.purchasedAt)
            ? purchasedAt
            : existing.purchasedAt,
        price: args.input.price ?? existing.price,
        purchases: purchasedAt
          ? [
              ...existing.purchases,
              { date: purchasedAt, price: args.input.price ?? null, quantity: args.input.quantity },
            ]
          : existing.purchases,
        updatedAt: new Date().toISOString(),
      };
      await putItem(updated);
      return updated;
    },

    updateInventoryItem: async (
      _: unknown,
      args: { id: string; input: UpdateInventoryItemInput },
      context: Context
    ): Promise<InventoryItem> => {
      await assertNotRateLimited(context.sourceIp);

      const existing = await getItem(args.id);
      if (!existing) throw new Error(`No inventory item found with id "${args.id}".`);

      const input = { ...args.input };
      if (input.unit !== undefined) input.unit = normalizeUnit(input.unit);

      const updated: InventoryItem = {
        ...existing,
        ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
        updatedAt: new Date().toISOString(),
      };

      await putItem(updated);
      return updated;
    },

    removeInventoryItem: async (_: unknown, args: { id: string }, context: Context): Promise<boolean> => {
      await assertNotRateLimited(context.sourceIp);

      const existing = await getItem(args.id);
      if (existing?.isStaple) {
        await upsertShoppingListEntry(existing.name, null, null, null, true);
      }

      const res = await ddb.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { pk: PK, sk: `${ITEM_PREFIX}${args.id}` },
          ReturnValues: "ALL_OLD",
        })
      );
      return res.Attributes !== undefined;
    },

    addToShoppingList: async (
      _: unknown,
      args: {
        name: string;
        quantity?: number | null;
        unit?: string | null;
        note?: string | null;
        isStaple?: boolean | null;
      },
      context: Context
    ): Promise<ShoppingListEntry> => {
      await assertNotRateLimited(context.sourceIp);
      return upsertShoppingListEntry(
        args.name,
        args.quantity ?? null,
        args.unit ?? null,
        args.note ?? null,
        args.isStaple ?? false
      );
    },

    removeFromShoppingList: async (_: unknown, args: { id: string }, context: Context): Promise<boolean> => {
      await assertNotRateLimited(context.sourceIp);

      const res = await ddb.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { pk: PK, sk: `${SHOPLIST_PREFIX}${args.id}` },
          ReturnValues: "ALL_OLD",
        })
      );
      return res.Attributes !== undefined;
    },

    updateSettings: async (
      _: unknown,
      args: { input: PantrySettingsInput },
      context: Context
    ): Promise<PantrySettings> => {
      await assertNotRateLimited(context.sourceIp);

      const existing = await getSettings();
      const updated: PantrySettings = {
        ...existing,
        ...Object.fromEntries(Object.entries(args.input).filter(([, v]) => v !== undefined)),
      };
      await putSettings(updated);
      return updated;
    },
  },
};
