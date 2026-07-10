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
  lowPriority: boolean;
  nearlyEmpty: boolean;
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
  category: string | null;
  recipeTag: string | null;
  urgent: boolean;
  addedAt: string;
}

interface UpdateShoppingListEntryInput {
  name?: string;
  quantity?: number | null;
  unit?: string | null;
  note?: string | null;
  isStaple?: boolean;
  category?: string | null;
  recipeTag?: string | null;
  urgent?: boolean;
}

export interface PantrySettings {
  view: string;
  sort: string;
  simple: boolean;
  optionsCollapsed: boolean;
  collapsedGroups: string[];
  commonItems: string[];
  shoppingListCollapsed: boolean;
  showLowPriority: boolean;
  categoryFilter: string | null;
  categories: string[];
  addItemDetailsShown: boolean;
  addItemCollapsed: boolean;
  commonItemsCollapsed: boolean;
  shoppingCategoryFilter: string | null;
  shoppingRecipeFilter: string | null;
  shoppingUrgentOnly: boolean;
}

interface PantrySettingsInput {
  view?: string;
  sort?: string;
  simple?: boolean;
  optionsCollapsed?: boolean;
  collapsedGroups?: string[];
  commonItems?: string[];
  shoppingListCollapsed?: boolean;
  showLowPriority?: boolean;
  categoryFilter?: string | null;
  categories?: string[];
  addItemDetailsShown?: boolean;
  addItemCollapsed?: boolean;
  commonItemsCollapsed?: boolean;
  shoppingCategoryFilter?: string | null;
  shoppingRecipeFilter?: string | null;
  shoppingUrgentOnly?: boolean;
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
  showLowPriority: false,
  categoryFilter: null,
  addItemDetailsShown: false,
  addItemCollapsed: false,
  commonItemsCollapsed: false,
  shoppingCategoryFilter: null,
  shoppingRecipeFilter: null,
  shoppingUrgentOnly: false,
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
  categories: [
    "Dairy",
    "Produce",
    "Meat",
    "Seafood",
    "Grains",
    "Spices",
    "Condiments",
    "Frozen",
    "Beverages",
    "Snacks",
    "Baking",
    "Canned Goods",
    "Bread",
    "Household",
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
  lowPriority?: boolean | null;
  nearlyEmpty?: boolean | null;
}

type UpdateInventoryItemInput = Partial<Omit<AddInventoryItemInput, "location">> & {
  location?: InventoryItem["location"];
};

// Backfills fields added after some rows were already written - critical
// for lowPriority/isStaple/nearlyEmpty specifically, since they're
// non-nullable: a missing value on even one row would fail the whole
// inventory query, not just that row (see getShoppingList's identical
// comment - this is the same class of bug, on the more heavily-populated
// type).
function withInventoryDefaults(item: InventoryItem): InventoryItem {
  return {
    ...item,
    isStaple: item.isStaple ?? false,
    lowPriority: item.lowPriority ?? false,
    nearlyEmpty: item.nearlyEmpty ?? false,
  };
}

async function getItem(id: string): Promise<InventoryItem | null> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { pk: PK, sk: `${ITEM_PREFIX}${id}` } })
  );
  const item = res.Item?.data as InventoryItem | undefined;
  return item ? withInventoryDefaults(item) : null;
}

async function getAllItems(): Promise<InventoryItem[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":pk": PK, ":prefix": ITEM_PREFIX },
    })
  );
  return (res.Items ?? []).map((i) => withInventoryDefaults(i.data as InventoryItem));
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
    lowPriority: input.lowPriority ?? false,
    nearlyEmpty: input.nearlyEmpty ?? false,
    // Only log an initial purchase batch if a date was actually given - no
    // point fabricating one for a bare-minimum add.
    purchases: purchasedAt
      ? [{ date: purchasedAt, price: input.price ?? null, quantity: input.quantity }]
      : [],
    addedAt: now,
    updatedAt: now,
  };
}

// Backfills fields added after some rows were already written. Critical
// for isStaple specifically - a missing non-nullable field fails the
// whole containing list, not just that one row, since GraphQL
// null-propagates a non-null violation up to the nearest nullable
// ancestor (see withInventoryDefaults's identical situation).
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
  };
}

async function getShoppingListEntry(id: string): Promise<ShoppingListEntry | null> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { pk: PK, sk: `${SHOPLIST_PREFIX}${id}` } })
  );
  const entry = res.Item?.data as ShoppingListEntry | undefined;
  return entry ? withShoppingListDefaults(entry) : null;
}

// Exported for the 4pm digest Lambda (lib/aws/send-digest.ts), which needs
// the same query outside of any GraphQL resolver context.
export async function getShoppingList(): Promise<ShoppingListEntry[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":pk": PK, ":prefix": SHOPLIST_PREFIX },
    })
  );
  return (res.Items ?? []).map((i) => withShoppingListDefaults(i.data as ShoppingListEntry));
}

async function putShoppingListEntry(entry: ShoppingListEntry): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { pk: PK, sk: `${SHOPLIST_PREFIX}${entry.id}`, type: "SHOPLIST", data: entry },
    })
  );
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
        addedAt: new Date().toISOString(),
      };

  await putShoppingListEntry(entry);
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
      const [inventory, shoppingList, settings] = await Promise.all([
        getAllItems(),
        getShoppingList(),
        getSettings(),
      ]);
      return parseCommand(
        args.input,
        args.history ?? [],
        inventory,
        shoppingList,
        settings.categories,
        context.sourceIp
      );
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
        await upsertShoppingListEntry(existing.name, null, null, null, true, existing.category);
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
        category?: string | null;
        recipeTag?: string | null;
        urgent?: boolean | null;
      },
      context: Context
    ): Promise<ShoppingListEntry> => {
      await assertNotRateLimited(context.sourceIp);
      return upsertShoppingListEntry(
        args.name,
        args.quantity ?? null,
        args.unit ?? null,
        args.note ?? null,
        args.isStaple ?? false,
        args.category ?? null,
        args.recipeTag ?? null,
        args.urgent ?? false
      );
    },

    updateShoppingListEntry: async (
      _: unknown,
      args: { id: string; input: UpdateShoppingListEntryInput },
      context: Context
    ): Promise<ShoppingListEntry> => {
      await assertNotRateLimited(context.sourceIp);

      const existing = await getShoppingListEntry(args.id);
      if (!existing) throw new Error(`No shopping list entry found with id "${args.id}".`);

      const input = { ...args.input };
      if (input.unit !== undefined) input.unit = normalizeUnit(input.unit);

      const updated: ShoppingListEntry = {
        ...existing,
        ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
      };

      await putShoppingListEntry(updated);
      return updated;
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
