import { randomUUID } from "node:crypto";
import { normalizeItemName, normalizeUnit } from "../lib/util/normalize";
import type { InventoryItem, ShoppingListEntry, PantrySettings } from "../resolvers/resolvers";

// In-memory mock store used only by dev/server.ts - no DynamoDB, no AWS
// credentials needed locally. Resets every time the dev server restarts.
const items = new Map<string, InventoryItem>();
const shoppingList = new Map<string, ShoppingListEntry>();

let settings: PantrySettings = {
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

function upsertShoppingListEntry(
  name: string,
  quantity: number | null,
  unit: string | null,
  note: string | null = null
): ShoppingListEntry {
  const normalizedUnit = unit ? normalizeUnit(unit) : null;
  const needle = normalizeItemName(name);
  const match = [...shoppingList.values()].find((e) => normalizeItemName(e.name) === needle);
  const entry: ShoppingListEntry = match
    ? {
        ...match,
        quantity: quantity ?? match.quantity,
        unit: normalizedUnit ?? match.unit,
        note: note ?? match.note,
      }
    : { id: randomUUID(), name, quantity, unit: normalizedUnit, note, addedAt: new Date().toISOString() };
  shoppingList.set(entry.id, entry);
  return entry;
}

interface MockProposedAction {
  type: string;
  summary: string;
  mutationName: string;
  argsJson: string;
}

interface MockRecipeSuggestion {
  name: string;
  description: string | null;
  ingredients: { name: string; amount: string | null; haveInInventory: boolean; itemId: string | null }[];
}

interface MockParsedCommand {
  answer: string | null;
  actions: MockProposedAction[] | null;
  recipes: MockRecipeSuggestion[] | null;
  message: string | null;
}

// Crude local keyword matching, no Anthropic call, no conversation history
// awareness - just enough to exercise the frontend's preview/confirm flow
// in local dev. The real implementation (api/src/pantry/lib/anthropic/
// parse-command.ts) is what actually ships and is what history/recipes are
// really tested against, live.
function mockParseCommand(input: string): MockParsedCommand {
  const trimmed = input.trim();
  const text = trimmed.toLowerCase();
  if (!text) return { answer: null, actions: null, recipes: null, message: "Type a command or question." };

  if (text.includes("expir")) {
    const soon = [...items.values()]
      .filter((i): i is InventoryItem & { expiresAt: string } => !!i.expiresAt)
      .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))
      .slice(0, 5);
    const answer = soon.length
      ? `Expiring soonest: ${soon.map((i) => `${i.name} (${i.expiresAt})`).join(", ")}.`
      : "Nothing in your inventory has an expiry date set.";
    return { answer, actions: null, recipes: null, message: null };
  }

  if (text.includes("recipe") || text.includes("make") || text.includes("cook")) {
    const have = [...items.values()].slice(0, 3);
    return {
      answer: null,
      actions: null,
      recipes: [
        {
          name: "Mock Recipe (dev server only)",
          description: "A placeholder suggestion - the real recipe engine only runs against the live API.",
          ingredients: [
            ...have.map((i) => ({ name: i.name, amount: null, haveInInventory: true, itemId: i.id })),
            { name: "Something you don't have", amount: "2 cups", haveInInventory: false, itemId: null },
          ],
        },
      ],
      message: null,
    };
  }

  if (text.startsWith("add") || text.includes("buy") || text.includes("bought")) {
    const name = trimmed.replace(/^(add|buy|bought)\s+/i, "").trim() || "New item";
    return {
      answer: null,
      actions: [
        {
          type: "RECORD_PURCHASE",
          summary: `Add "${name}" to the pantry (mock preview - dev server only)`,
          mutationName: "recordPurchase",
          argsJson: JSON.stringify({
            input: {
              name,
              location: "PANTRY",
              quantity: 1,
              unit: null,
              price: null,
              purchasedAt: new Date().toISOString().slice(0, 10),
              expiresAt: null,
              isStaple: null,
            },
          }),
        },
      ],
      recipes: null,
      message: null,
    };
  }

  if (text.includes("remove") || text.includes("out of") || text.includes("used")) {
    const match = [...items.values()].find((i) => text.includes(i.name.toLowerCase()));
    if (!match) {
      return { answer: null, actions: null, recipes: null, message: "Couldn't find an item matching that name." };
    }
    return {
      answer: null,
      actions: [
        {
          type: "REMOVE_INVENTORY_ITEM",
          summary: `Remove "${match.name}" from inventory (mock preview - dev server only)`,
          mutationName: "removeInventoryItem",
          argsJson: JSON.stringify({ id: match.id }),
        },
      ],
      recipes: null,
      message: null,
    };
  }

  return {
    answer: null,
    actions: null,
    recipes: null,
    message:
      'This is a local mock - only "add X", "remove X", "what\'s expiring", and "recipe" are recognized.',
  };
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
    parseCommand: (_: unknown, args: { input: string; history?: unknown }) => mockParseCommand(args.input),
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
      if (existing?.isStaple) upsertShoppingListEntry(existing.name, null, null);
      return items.delete(args.id);
    },
    addToShoppingList: (
      _: unknown,
      args: { name: string; quantity?: number | null; unit?: string | null; note?: string | null }
    ) => upsertShoppingListEntry(args.name, args.quantity ?? null, args.unit ?? null, args.note ?? null),
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
