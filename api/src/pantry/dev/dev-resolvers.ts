import { randomUUID } from "node:crypto";
import { normalizeItemName, normalizeUnit } from "../lib/util/normalize";
import type { InventoryItem } from "../services/inventory";
import type { ShoppingListEntry } from "../services/shopping-list";
import type { PantrySettings } from "../services/settings";

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
  showLowPriority: false,
  categoryFilter: null,
  addItemDetailsShown: false,
  addItemCollapsed: false,
  commonItemsCollapsed: false,
  shoppingCategoryFilter: null,
  shoppingRecipeFilter: null,
  shoppingUrgentOnly: false,
  digestEnabled: true,
  digestHour: 16,
  nerdModeInventory: false,
  nerdModeShoppingList: false,
  nerdModeCommandBar: false,
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

function seed(
  item: Omit<
    InventoryItem,
    | "id"
    | "addedAt"
    | "updatedAt"
    | "isStaple"
    | "lowPriority"
    | "nearlyEmpty"
    | "trackPrice"
    | "lastKnownPrice"
    | "purchases"
  >
): void {
  const id = randomUUID();
  const now = new Date().toISOString();
  const purchases = item.purchasedAt
    ? [{ date: item.purchasedAt, price: item.price, quantity: item.quantity }]
    : [];
  items.set(id, {
    ...item,
    id,
    addedAt: now,
    updatedAt: now,
    isStaple: false,
    lowPriority: false,
    nearlyEmpty: false,
    trackPrice: false,
    lastKnownPrice: null,
    purchases,
  });
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

// Demo data for trackPrice/lastKnownPrice so the UI has something to render
// locally without needing a real price-check Lambda run.
const milkEntry = [...items.values()].find((i) => i.name === "Milk");
if (milkEntry) {
  items.set(milkEntry.id, {
    ...milkEntry,
    trackPrice: true,
    lastKnownPrice: {
      colesPrice: 3.55,
      productUrl: null,
      note: null,
      checkedAt: new Date().toISOString(),
      debugInfo: { costUsd: 0.002, durationMs: 4200, searchesUsed: 2, fetchesUsed: 1 },
    },
  });
}

type AddInput = Omit<
  InventoryItem,
  | "id"
  | "addedAt"
  | "updatedAt"
  | "purchases"
  | "isStaple"
  | "lowPriority"
  | "nearlyEmpty"
  | "trackPrice"
  | "lastKnownPrice"
> & {
  isStaple?: boolean | null;
  lowPriority?: boolean | null;
  nearlyEmpty?: boolean | null;
  trackPrice?: boolean | null;
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
    lowPriority: input.lowPriority ?? false,
    nearlyEmpty: input.nearlyEmpty ?? false,
    trackPrice: input.trackPrice ?? false,
    lastKnownPrice: null,
    purchases: input.purchasedAt
      ? [{ date: input.purchasedAt, price: input.price, quantity: input.quantity }]
      : [],
  };
}

function upsertShoppingListEntry(
  name: string,
  quantity: number | null,
  unit: string | null,
  note: string | null = null,
  isStaple = false,
  category: string | null = null,
  recipeTag: string | null = null,
  urgent = false
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
        category: category ?? match.category,
        recipeTag: recipeTag ?? match.recipeTag,
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
  shoppingList.set(entry.id, entry);
  return entry;
}

interface MockProposedAction {
  type: string;
  summary: string;
  mutationName: string;
  argsJson: string;
  estimatedPriceAud: number | null;
}

interface MockRecipeSuggestion {
  name: string;
  description: string | null;
  ingredients: {
    name: string;
    amount: string | null;
    haveInInventory: boolean;
    itemId: string | null;
    quantity: number;
    estimatedPriceAud: number;
  }[];
  baseServings: number;
  caloriesPerServing: number;
  proteinGPerServing: number;
  carbsGPerServing: number;
  fatGPerServing: number;
}

interface MockParsedCommand {
  answer: string | null;
  answerItems: string[] | null;
  actions: MockProposedAction[] | null;
  recipes: MockRecipeSuggestion[] | null;
  message: string | null;
  debugInfo: { costUsd: number; durationMs: number; searchesUsed: number; fetchesUsed: number };
}

// No real Anthropic call in dev mode, so there's nothing to measure - zeros
// read as "this ran locally, not against the real model" rather than a
// real (if tiny) cost/duration.
const MOCK_DEBUG_INFO = { costUsd: 0, durationMs: 0, searchesUsed: 0, fetchesUsed: 0 };

// Crude local keyword matching, no Anthropic call, no conversation history
// awareness - just enough to exercise the frontend's preview/confirm flow
// in local dev. The real implementation (api/src/pantry/lib/anthropic/
// parse-command.ts) is what actually ships and is what history/recipes are
// really tested against, live.
function mockParseCommand(input: string): MockParsedCommand {
  const trimmed = input.trim();
  const text = trimmed.toLowerCase();
  if (!text) {
    return {
      answer: null,
      answerItems: null,
      actions: null,
      recipes: null,
      message: "Type a command or question.",
      debugInfo: MOCK_DEBUG_INFO,
    };
  }

  if (text.includes("expir")) {
    const soon = [...items.values()]
      .filter((i): i is InventoryItem & { expiresAt: string } => !!i.expiresAt)
      .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))
      .slice(0, 5);
    return {
      answer: soon.length ? "Expiring soonest:" : "Nothing in your inventory has an expiry date set.",
      answerItems: soon.length ? soon.map((i) => `${i.name} (${i.expiresAt})`) : null,
      actions: null,
      recipes: null,
      message: null,
      debugInfo: MOCK_DEBUG_INFO,
    };
  }

  if (text.includes("recipe") || text.includes("make") || text.includes("cook")) {
    const have = [...items.values()].slice(0, 3);
    return {
      answer: null,
      answerItems: null,
      actions: null,
      recipes: [
        {
          name: "Mock Recipe (dev server only)",
          description: "A placeholder suggestion - the real recipe engine only runs against the live API.",
          ingredients: [
            ...have.map((i) => ({
              name: i.name,
              amount: null,
              haveInInventory: true,
              itemId: i.id,
              quantity: 0,
              estimatedPriceAud: 0,
            })),
            {
              name: "Something you don't have",
              amount: "2 cups",
              haveInInventory: false,
              itemId: null,
              quantity: 2,
              estimatedPriceAud: 3.5,
            },
          ],
          baseServings: 2,
          caloriesPerServing: 450,
          proteinGPerServing: 20,
          carbsGPerServing: 55,
          fatGPerServing: 12,
        },
      ],
      message: null,
      debugInfo: MOCK_DEBUG_INFO,
    };
  }

  if (text.startsWith("add") || text.includes("buy") || text.includes("bought")) {
    const name = trimmed.replace(/^(add|buy|bought)\s+/i, "").trim() || "New item";
    return {
      answer: null,
      answerItems: null,
      actions: [
        {
          type: "RECORD_PURCHASE",
          summary: `Add "${name}" to the pantry (mock preview - dev server only)`,
          mutationName: "recordPurchase",
          argsJson: JSON.stringify({
            input: {
              name,
              location: "PANTRY",
              category: null,
              quantity: 1,
              unit: null,
              price: null,
              purchasedAt: new Date().toISOString().slice(0, 10),
              expiresAt: null,
              isStaple: null,
              lowPriority: null,
              nearlyEmpty: null,
              trackPrice: null,
            },
          }),
          estimatedPriceAud: null,
        },
      ],
      recipes: null,
      message: null,
      debugInfo: MOCK_DEBUG_INFO,
    };
  }

  if (text.includes("remove") || text.includes("out of") || text.includes("used")) {
    const match = [...items.values()].find((i) => text.includes(i.name.toLowerCase()));
    if (!match) {
      return {
        answer: null,
        answerItems: null,
        actions: null,
        recipes: null,
        message: "Couldn't find an item matching that name.",
        debugInfo: MOCK_DEBUG_INFO,
      };
    }
    return {
      answer: null,
      answerItems: null,
      actions: [
        {
          type: "REMOVE_INVENTORY_ITEM",
          summary: `Remove "${match.name}" from inventory (mock preview - dev server only)`,
          mutationName: "removeInventoryItem",
          argsJson: JSON.stringify({ id: match.id }),
          estimatedPriceAud: null,
        },
      ],
      recipes: null,
      message: null,
      debugInfo: MOCK_DEBUG_INFO,
    };
  }

  return {
    answer: null,
    answerItems: null,
    actions: null,
    recipes: null,
    message:
      'This is a local mock - only "add X", "remove X", "what\'s expiring", and "recipe" are recognized.',
    debugInfo: MOCK_DEBUG_INFO,
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
      if (existing?.isStaple) {
        upsertShoppingListEntry(existing.name, null, null, null, true, existing.category);
      }
      return items.delete(args.id);
    },
    addToShoppingList: (
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
      }
    ) =>
      upsertShoppingListEntry(
        args.name,
        args.quantity ?? null,
        args.unit ?? null,
        args.note ?? null,
        args.isStaple ?? false,
        args.category ?? null,
        args.recipeTag ?? null,
        args.urgent ?? false
      ),
    updateShoppingListEntry: (
      _: unknown,
      args: {
        id: string;
        input: {
          name?: string;
          quantity?: number | null;
          unit?: string | null;
          note?: string | null;
          isStaple?: boolean;
          category?: string | null;
          recipeTag?: string | null;
          urgent?: boolean;
          trackPrice?: boolean;
        };
      }
    ) => {
      const existing = shoppingList.get(args.id);
      if (!existing) throw new Error(`No shopping list entry found with id "${args.id}".`);
      const input = { ...args.input };
      if (input.unit !== undefined) input.unit = normalizeUnit(input.unit);
      const updated: ShoppingListEntry = {
        ...existing,
        ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
      };
      shoppingList.set(args.id, updated);
      return updated;
    },
    removeFromShoppingList: (_: unknown, args: { id: string }) => shoppingList.delete(args.id),
    updateSettings: (_: unknown, args: { input: Partial<PantrySettings> }) => {
      settings = {
        ...settings,
        ...Object.fromEntries(Object.entries(args.input).filter(([, v]) => v !== undefined)),
      };
      return settings;
    },
    // No Lambda to invoke locally - just acknowledges the click.
    syncPricesNow: () => true,
  },
};
