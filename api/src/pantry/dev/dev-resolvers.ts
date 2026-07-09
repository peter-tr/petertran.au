import { randomUUID } from "node:crypto";
import { normalizeItemName, normalizeUnit } from "../lib/util/normalize";
import type { InventoryItem, ShoppingListEntry, PantrySettings } from "../resolvers/resolvers";

// In-memory mock store used only by dev/server.ts - no DynamoDB, no AWS
// credentials needed locally. Resets every time the dev server restarts.
const items = new Map<string, InventoryItem>();
const shoppingList = new Map<string, ShoppingListEntry>();

let settings: PantrySettings = {
  view: "location",
  simple: false,
  optionsCollapsed: false,
  collapsedGroups: [],
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

function seed(item: Omit<InventoryItem, "id" | "addedAt" | "updatedAt" | "isStaple" | "purchases">): void {
  const id = randomUUID();
  const now = new Date().toISOString();
  const purchases = item.purchasedAt
    ? [{ date: item.purchasedAt, price: item.price, quantity: item.quantity }]
    : [];
  items.set(id, { ...item, id, addedAt: now, updatedAt: now, isStaple: false, purchases });
}

seed({
  name: "Milk",
  category: "Dairy",
  location: "FRIDGE",
  quantity: 2,
  unit: "L",
  price: 4.5,
  purchasedAt: "2026-07-05",
  expiresAt: "2026-07-14",
});
seed({
  name: "Chicken breast",
  category: "Meat",
  location: "FREEZER",
  quantity: 1,
  unit: "kg",
  price: 12.0,
  purchasedAt: "2026-07-01",
  expiresAt: null,
});
seed({
  name: "Rice",
  category: "Grains",
  location: "PANTRY",
  quantity: 5,
  unit: "kg",
  price: 8.0,
  purchasedAt: "2026-06-20",
  expiresAt: null,
});

type AddInput = Omit<InventoryItem, "id" | "addedAt" | "updatedAt" | "purchases" | "isStaple"> & {
  isStaple?: boolean | null;
};

function createItem(input: AddInput): InventoryItem {
  const id = randomUUID();
  const now = new Date().toISOString();
  return {
    ...input,
    unit: normalizeUnit(input.unit),
    id,
    addedAt: now,
    updatedAt: now,
    isStaple: input.isStaple ?? false,
    purchases: input.purchasedAt
      ? [{ date: input.purchasedAt, price: input.price, quantity: input.quantity }]
      : [],
  };
}

function addToShoppingListIfMissing(name: string): ShoppingListEntry {
  const needle = normalizeItemName(name);
  const match = [...shoppingList.values()].find((e) => normalizeItemName(e.name) === needle);
  if (match) return match;
  const id = randomUUID();
  const entry: ShoppingListEntry = { id, name, addedAt: new Date().toISOString() };
  shoppingList.set(id, entry);
  return entry;
}

export const devResolvers = {
  Query: {
    inventory: (_: unknown, args: { location?: InventoryItem["location"] }) => {
      const all = [...items.values()].sort((a, b) => b.addedAt.localeCompare(a.addedAt));
      return args.location ? all.filter((i) => i.location === args.location) : all;
    },
    inventoryItem: (_: unknown, args: { id: string }) => items.get(args.id) ?? null,
    shoppingList: () => [...shoppingList.values()].sort((a, b) => a.addedAt.localeCompare(b.addedAt)),
    settings: () => settings,
  },
  Mutation: {
    addInventoryItem: (_: unknown, args: { input: AddInput }) => {
      const item = createItem(args.input);
      items.set(item.id, item);
      return item;
    },
    recordPurchase: (_: unknown, args: { input: AddInput }) => {
      const needle = normalizeItemName(args.input.name);
      const existing = [...items.values()].find(
        (i) => i.location === args.input.location && normalizeItemName(i.name) === needle
      );

      if (!existing) {
        const item = createItem(args.input);
        items.set(item.id, item);
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
      items.set(existing.id, updated);
      return updated;
    },
    updateInventoryItem: (_: unknown, args: { id: string; input: Partial<InventoryItem> }) => {
      const existing = items.get(args.id);
      if (!existing) throw new Error(`No inventory item found with id "${args.id}".`);
      const input = { ...args.input };
      if (input.unit !== undefined) input.unit = normalizeUnit(input.unit);
      const updated: InventoryItem = {
        ...existing,
        ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
        updatedAt: new Date().toISOString(),
      };
      items.set(args.id, updated);
      return updated;
    },
    removeInventoryItem: (_: unknown, args: { id: string }) => {
      const existing = items.get(args.id);
      if (existing?.isStaple) addToShoppingListIfMissing(existing.name);
      return items.delete(args.id);
    },
    addToShoppingList: (_: unknown, args: { name: string }) => addToShoppingListIfMissing(args.name),
    removeFromShoppingList: (_: unknown, args: { id: string }) => shoppingList.delete(args.id),
    updateSettings: (_: unknown, args: { input: Partial<PantrySettings> }) => {
      settings = {
        ...settings,
        ...Object.fromEntries(Object.entries(args.input).filter(([, v]) => v !== undefined)),
      };
      return settings;
    },
  },
};
