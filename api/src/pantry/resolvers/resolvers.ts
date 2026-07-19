import { assertNotRateLimited } from "../lib/util/rate-limit";
import { assertAiNotRateLimited } from "../lib/util/ai-rate-limit";
import { normalizeItemName, normalizeUnit } from "../lib/util/normalize";
import { parseCommand, type ParsedCommandResult } from "../lib/anthropic/parse-command";
import { checkPrice } from "../lib/anthropic/check-prices";
import {
  getItem,
  getAllItems,
  putItem,
  deleteItem,
  createItem,
  setLastKnownPrice,
  type InventoryItem,
  type AddInventoryItemInput,
  type UpdateInventoryItemInput,
  type LastKnownPrice,
} from "../services/inventory";
import {
  getShoppingListEntry,
  getShoppingList,
  putShoppingListEntry,
  deleteShoppingListEntry,
  upsertShoppingListEntry,
  setShoppingListLastKnownPrice,
  type ShoppingListEntry,
  type UpdateShoppingListEntryInput,
} from "../services/shopping-list";
import {
  getSettings,
  putSettings,
  type PantrySettings,
  type PantrySettingsInput,
} from "../services/settings";
import { getPriceSyncStatus, type PriceSyncStatus } from "../services/price-sync-status";
import { triggerPriceSync } from "../lib/aws/sync-prices";
import type { Context } from "../context";

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
    priceSyncStatus: (): Promise<PriceSyncStatus> => getPriceSyncStatus(),
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

      return deleteItem(args.id);
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

      return deleteShoppingListEntry(args.id);
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

    syncPricesNow: async (_: unknown, args: unknown, context: Context): Promise<boolean> => {
      await assertNotRateLimited(context.sourceIp);
      await triggerPriceSync();

      return true;
    },

    // Synchronous, unlike everything else here that touches prices - the
    // command bar's "want me to check now?" offer is a one-off, explicitly
    // user-initiated Anthropic call, so it uses the AI limiter (15/min) not
    // the plain CRUD one, and awaits the real result instead of firing the
    // background worker.
    checkPriceNow: async (
      _: unknown,
      args: { id: string; list: string },
      context: Context
    ): Promise<boolean> => {
      await assertAiNotRateLimited(context.sourceIp);

      const name =
        args.list === "inventory"
          ? (await getItem(args.id))?.name
          : (await getShoppingListEntry(args.id))?.name;
      if (!name)
        throw new Error(
          `No ${args.list === "inventory" ? "inventory item" : "shopping list entry"} found with id "${args.id}".`
        );

      const result = await checkPrice(name);
      const price: LastKnownPrice = { ...result, checkedAt: new Date().toISOString() };
      if (args.list === "inventory") {
        await setLastKnownPrice(args.id, price);
      } else {
        await setShoppingListLastKnownPrice(args.id, price);
      }

      return true;
    },
  },
};
