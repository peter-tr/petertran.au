import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InventoryItem } from "../services/inventory";
import type { ShoppingListEntry } from "../services/shopping-list";
import type { PantrySettings } from "../services/settings";
import type { PriceSyncStatus } from "../services/price-sync-status";
import type { Context } from "../context";

const assertNotRateLimited = vi.fn(async () => undefined);
const assertAiNotRateLimited = vi.fn(async () => undefined);

const getItem = vi.fn<(id: string) => Promise<InventoryItem | null>>();
const getAllItems = vi.fn<() => Promise<InventoryItem[]>>();
const putItem = vi.fn(async () => undefined);
const deleteItem = vi.fn<(id: string) => Promise<boolean>>();
const createItem = vi.fn();
const setLastKnownPrice = vi.fn(async () => undefined);

const getShoppingListEntry = vi.fn<(id: string) => Promise<ShoppingListEntry | null>>();
const getShoppingList = vi.fn<() => Promise<ShoppingListEntry[]>>();
const putShoppingListEntry = vi.fn(async () => undefined);
const deleteShoppingListEntry = vi.fn<(id: string) => Promise<boolean>>();
const upsertShoppingListEntry = vi.fn();
const setShoppingListLastKnownPrice = vi.fn(async () => undefined);

const getSettings = vi.fn<() => Promise<PantrySettings>>();
const putSettings = vi.fn(async () => undefined);

const getPriceSyncStatus = vi.fn<() => Promise<PriceSyncStatus>>();
const triggerPriceSync = vi.fn(async () => undefined);

const parseCommand = vi.fn();
const checkPrice = vi.fn();

vi.mock("../lib/util/rate-limit", () => ({
  assertNotRateLimited: (ip: string | undefined) => assertNotRateLimited(ip),
}));
vi.mock("../lib/util/ai-rate-limit", () => ({
  assertAiNotRateLimited: (ip: string | undefined) => assertAiNotRateLimited(ip),
}));
vi.mock("../lib/anthropic/parse-command", () => ({
  parseCommand: (...args: unknown[]) => parseCommand(...args),
}));
vi.mock("../lib/anthropic/check-prices", () => ({
  checkPrice: (...args: unknown[]) => checkPrice(...args),
}));
vi.mock("../services/inventory", () => ({
  getItem: (id: string) => getItem(id),
  getAllItems: () => getAllItems(),
  putItem: (item: unknown) => putItem(item),
  deleteItem: (id: string) => deleteItem(id),
  createItem: (input: unknown) => createItem(input),
  setLastKnownPrice: (id: string, price: unknown) => setLastKnownPrice(id, price),
}));
vi.mock("../services/shopping-list", () => ({
  getShoppingListEntry: (id: string) => getShoppingListEntry(id),
  getShoppingList: () => getShoppingList(),
  putShoppingListEntry: (entry: unknown) => putShoppingListEntry(entry),
  deleteShoppingListEntry: (id: string) => deleteShoppingListEntry(id),
  upsertShoppingListEntry: (...args: unknown[]) => upsertShoppingListEntry(...args),
  setShoppingListLastKnownPrice: (id: string, price: unknown) => setShoppingListLastKnownPrice(id, price),
}));
vi.mock("../services/settings", () => ({
  getSettings: () => getSettings(),
  putSettings: (settings: unknown) => putSettings(settings),
}));
vi.mock("../services/price-sync-status", () => ({
  getPriceSyncStatus: () => getPriceSyncStatus(),
}));
vi.mock("../lib/aws/sync-prices", () => ({
  triggerPriceSync: () => triggerPriceSync(),
}));

const { resolvers } = await import("./resolvers");

function ctx(overrides: Partial<Context> = {}): Context {
  return { sourceIp: "1.2.3.4", xraySegment: undefined, ...overrides } as Context;
}

function inventoryItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: "inv-1",
    name: "Milk",
    category: "Dairy",
    location: "FRIDGE",
    quantity: 1,
    unit: "L",
    price: null,
    purchasedAt: null,
    expiresAt: null,
    isStaple: false,
    lowPriority: false,
    nearlyEmpty: false,
    trackPrice: false,
    lastKnownPrice: null,
    purchases: [],
    addedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function shoppingListEntry(overrides: Partial<ShoppingListEntry> = {}): ShoppingListEntry {
  return {
    id: "sl-1",
    name: "Eggs",
    quantity: 1,
    unit: "dozen",
    note: null,
    isStaple: false,
    category: null,
    recipeTag: null,
    urgent: false,
    trackPrice: false,
    lastKnownPrice: null,
    addedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  assertNotRateLimited.mockResolvedValue(undefined);
  assertAiNotRateLimited.mockResolvedValue(undefined);
});

describe("Query.inventory", () => {
  it("returns all items sorted by addedAt descending when no location filter is given", async () => {
    getAllItems.mockResolvedValue([
      inventoryItem({ id: "a", addedAt: "2026-01-01T00:00:00.000Z" }),
      inventoryItem({ id: "b", addedAt: "2026-03-01T00:00:00.000Z" }),
    ]);

    const result = await resolvers.Query.inventory(null, {});

    expect(result.map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("filters by location when given", async () => {
    getAllItems.mockResolvedValue([
      inventoryItem({ id: "fridge-1", location: "FRIDGE" }),
      inventoryItem({ id: "pantry-1", location: "PANTRY" }),
    ]);

    const result = await resolvers.Query.inventory(null, { location: "PANTRY" });

    expect(result.map((i) => i.id)).toEqual(["pantry-1"]);
  });
});

describe("Query.inventoryItem", () => {
  it("delegates to getItem", async () => {
    getItem.mockResolvedValue(inventoryItem({ id: "x" }));

    const result = await resolvers.Query.inventoryItem(null, { id: "x" });

    expect(getItem).toHaveBeenCalledWith("x");
    expect((result as InventoryItem).id).toBe("x");
  });
});

describe("Query.shoppingList", () => {
  it("returns entries sorted by addedAt ascending", async () => {
    getShoppingList.mockResolvedValue([
      shoppingListEntry({ id: "later", addedAt: "2026-03-01T00:00:00.000Z" }),
      shoppingListEntry({ id: "earlier", addedAt: "2026-01-01T00:00:00.000Z" }),
    ]);

    const result = await resolvers.Query.shoppingList();

    expect(result.map((e) => e.id)).toEqual(["earlier", "later"]);
  });
});

describe("Query.settings / priceSyncStatus", () => {
  it("settings delegates to getSettings", async () => {
    const settings = { view: "location" } as PantrySettings;
    getSettings.mockResolvedValue(settings);

    await expect(resolvers.Query.settings()).resolves.toBe(settings);
  });

  it("priceSyncStatus delegates to getPriceSyncStatus", async () => {
    const status = { running: false } as PriceSyncStatus;
    getPriceSyncStatus.mockResolvedValue(status);

    await expect(resolvers.Query.priceSyncStatus()).resolves.toBe(status);
  });
});

describe("Query.parseCommand", () => {
  it("gathers inventory/shoppingList/settings and forwards categories, sourceIp, and xraySegment", async () => {
    const inventory = [inventoryItem()];
    const shoppingList = [shoppingListEntry()];
    const settings = { categories: ["Dairy", "Produce"] } as PantrySettings;
    getAllItems.mockResolvedValue(inventory);
    getShoppingList.mockResolvedValue(shoppingList);
    getSettings.mockResolvedValue(settings);
    parseCommand.mockResolvedValue({ answer: "ok" });

    const context = ctx({ sourceIp: "9.9.9.9" });
    await resolvers.Query.parseCommand(null, { input: "what do I have" }, context);

    expect(parseCommand).toHaveBeenCalledWith(
      "what do I have",
      [],
      inventory,
      shoppingList,
      ["Dairy", "Produce"],
      "9.9.9.9",
      context.xraySegment
    );
  });

  it("defaults history to an empty array when not given", async () => {
    getAllItems.mockResolvedValue([]);
    getShoppingList.mockResolvedValue([]);
    getSettings.mockResolvedValue({ categories: [] } as unknown as PantrySettings);
    parseCommand.mockResolvedValue({});

    await resolvers.Query.parseCommand(null, { input: "hi" }, ctx());

    expect(parseCommand.mock.calls[0][1]).toEqual([]);
  });
});

describe("Mutation.addInventoryItem", () => {
  it("checks the rate limiter, then creates and persists the item", async () => {
    const item = inventoryItem();
    createItem.mockReturnValue(item);

    const result = await resolvers.Mutation.addInventoryItem(
      null,
      { input: { name: "Milk", location: "FRIDGE", quantity: 1 } },
      ctx({ sourceIp: "5.5.5.5" })
    );

    expect(assertNotRateLimited).toHaveBeenCalledWith("5.5.5.5");
    expect(createItem).toHaveBeenCalledWith({ name: "Milk", location: "FRIDGE", quantity: 1 });
    expect(putItem).toHaveBeenCalledWith(item);
    expect(result).toBe(item);
  });

  it("propagates a rate-limit error without creating or persisting anything", async () => {
    assertNotRateLimited.mockRejectedValue(new Error("Too many requests"));

    await expect(
      resolvers.Mutation.addInventoryItem(
        null,
        { input: { name: "Milk", location: "FRIDGE", quantity: 1 } },
        ctx()
      )
    ).rejects.toThrow("Too many requests");

    expect(createItem).not.toHaveBeenCalled();
    expect(putItem).not.toHaveBeenCalled();
  });
});

describe("Mutation.recordPurchase", () => {
  it("creates a new item when nothing matches by normalized name + location", async () => {
    getAllItems.mockResolvedValue([]);

    const newItem = inventoryItem({ id: "new" });
    createItem.mockReturnValue(newItem);

    const result = await resolvers.Mutation.recordPurchase(
      null,
      { input: { name: "Milk", location: "FRIDGE", quantity: 1 } },
      ctx()
    );

    expect(putItem).toHaveBeenCalledWith(newItem);
    expect(result).toBe(newItem);
  });

  it("merges into an existing item at the same location matched by normalized name", async () => {
    const existing = inventoryItem({
      id: "existing",
      name: "Eggs",
      quantity: 1,
      location: "FRIDGE",
      purchases: [],
    });
    getAllItems.mockResolvedValue([existing]);

    const result = await resolvers.Mutation.recordPurchase(
      null,
      { input: { name: "eggs", location: "FRIDGE", quantity: 2, purchasedAt: "2026-02-01", price: 5 } },
      ctx()
    );

    expect(createItem).not.toHaveBeenCalled();
    expect(result.id).toBe("existing");
    expect(result.quantity).toBe(3);
    expect(result.purchases).toEqual([{ date: "2026-02-01", price: 5, quantity: 2 }]);
    expect(putItem).toHaveBeenCalledWith(expect.objectContaining({ id: "existing", quantity: 3 }));
  });

  it("does not merge into an item with the same name but a different location", async () => {
    getAllItems.mockResolvedValue([inventoryItem({ id: "pantry-milk", name: "Milk", location: "PANTRY" })]);

    const newItem = inventoryItem({ id: "new-fridge-milk", location: "FRIDGE" });
    createItem.mockReturnValue(newItem);

    const result = await resolvers.Mutation.recordPurchase(
      null,
      { input: { name: "Milk", location: "FRIDGE", quantity: 1 } },
      ctx()
    );

    expect(result).toBe(newItem);
  });

  it("checks the rate limiter before touching inventory", async () => {
    assertNotRateLimited.mockRejectedValue(new Error("nope"));

    await expect(
      resolvers.Mutation.recordPurchase(
        null,
        { input: { name: "Milk", location: "FRIDGE", quantity: 1 } },
        ctx()
      )
    ).rejects.toThrow("nope");
    expect(getAllItems).not.toHaveBeenCalled();
  });
});

describe("Mutation.updateInventoryItem", () => {
  it("throws when the item doesn't exist", async () => {
    getItem.mockResolvedValue(null);

    await expect(
      resolvers.Mutation.updateInventoryItem(null, { id: "missing", input: {} }, ctx())
    ).rejects.toThrow('No inventory item found with id "missing".');
    expect(putItem).not.toHaveBeenCalled();
  });

  it("merges only the defined input fields onto the existing item and normalizes the unit", async () => {
    getItem.mockResolvedValue(inventoryItem({ id: "x", quantity: 1, unit: "L", category: "Dairy" }));

    const result = await resolvers.Mutation.updateInventoryItem(
      null,
      { id: "x", input: { quantity: 2, unit: "liters" } },
      ctx()
    );

    expect(result.quantity).toBe(2);
    expect(result.unit).toBe("L");
    expect(result.category).toBe("Dairy");
    expect(putItem).toHaveBeenCalledWith(expect.objectContaining({ quantity: 2, unit: "L" }));
  });
});

describe("Mutation.removeInventoryItem", () => {
  it("also adds a staple item back to the shopping list before deleting it", async () => {
    getItem.mockResolvedValue(inventoryItem({ id: "x", name: "Milk", isStaple: true, category: "Dairy" }));
    deleteItem.mockResolvedValue(true);

    const result = await resolvers.Mutation.removeInventoryItem(null, { id: "x" }, ctx());

    expect(upsertShoppingListEntry).toHaveBeenCalledWith("Milk", null, null, null, true, "Dairy");
    expect(deleteItem).toHaveBeenCalledWith("x");
    expect(result).toBe(true);
  });

  it("does not touch the shopping list for a non-staple item", async () => {
    getItem.mockResolvedValue(inventoryItem({ id: "x", isStaple: false }));
    deleteItem.mockResolvedValue(true);

    await resolvers.Mutation.removeInventoryItem(null, { id: "x" }, ctx());

    expect(upsertShoppingListEntry).not.toHaveBeenCalled();
  });

  it("still attempts the delete (and returns its result) when the item is already gone", async () => {
    getItem.mockResolvedValue(null);
    deleteItem.mockResolvedValue(false);

    const result = await resolvers.Mutation.removeInventoryItem(null, { id: "gone" }, ctx());

    expect(upsertShoppingListEntry).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });
});

describe("Mutation.addToShoppingList", () => {
  it("checks the rate limiter and applies defaults for optional args", async () => {
    const entry = shoppingListEntry();
    upsertShoppingListEntry.mockResolvedValue(entry);

    const result = await resolvers.Mutation.addToShoppingList(
      null,
      { name: "Bread" },
      ctx({ sourceIp: "7.7.7.7" })
    );

    expect(assertNotRateLimited).toHaveBeenCalledWith("7.7.7.7");
    expect(upsertShoppingListEntry).toHaveBeenCalledWith("Bread", null, null, null, false, null, null, false);
    expect(result).toBe(entry);
  });

  it("forwards explicitly given optional args", async () => {
    upsertShoppingListEntry.mockResolvedValue(shoppingListEntry());

    await resolvers.Mutation.addToShoppingList(
      null,
      {
        name: "Bread",
        quantity: 2,
        unit: "loaves",
        note: "for the week",
        isStaple: true,
        category: "Bread",
        recipeTag: "Sandwiches",
        urgent: true,
      },
      ctx()
    );

    expect(upsertShoppingListEntry).toHaveBeenCalledWith(
      "Bread",
      2,
      "loaves",
      "for the week",
      true,
      "Bread",
      "Sandwiches",
      true
    );
  });
});

describe("Mutation.updateShoppingListEntry", () => {
  it("throws when the entry doesn't exist", async () => {
    getShoppingListEntry.mockResolvedValue(null);

    await expect(
      resolvers.Mutation.updateShoppingListEntry(null, { id: "missing", input: {} }, ctx())
    ).rejects.toThrow('No shopping list entry found with id "missing".');
  });

  it("merges defined fields and normalizes the unit", async () => {
    getShoppingListEntry.mockResolvedValue(shoppingListEntry({ id: "x", quantity: 1, unit: "dozen" }));

    const result = await resolvers.Mutation.updateShoppingListEntry(
      null,
      { id: "x", input: { quantity: 2, unit: "grams" } },
      ctx()
    );

    expect(result.quantity).toBe(2);
    expect(result.unit).toBe("g");
    expect(putShoppingListEntry).toHaveBeenCalledWith(expect.objectContaining({ quantity: 2, unit: "g" }));
  });
});

describe("Mutation.removeFromShoppingList", () => {
  it("checks the rate limiter then deletes", async () => {
    deleteShoppingListEntry.mockResolvedValue(true);

    const result = await resolvers.Mutation.removeFromShoppingList(
      null,
      { id: "x" },
      ctx({ sourceIp: "1.1.1.1" })
    );

    expect(assertNotRateLimited).toHaveBeenCalledWith("1.1.1.1");
    expect(deleteShoppingListEntry).toHaveBeenCalledWith("x");
    expect(result).toBe(true);
  });
});

describe("Mutation.updateSettings", () => {
  it("merges only the defined input fields onto the existing settings", async () => {
    getSettings.mockResolvedValue({ view: "location", sort: "recent" } as PantrySettings);

    const result = await resolvers.Mutation.updateSettings(null, { input: { view: "grid" } }, ctx());

    expect(result.view).toBe("grid");
    expect(result.sort).toBe("recent");
    expect(putSettings).toHaveBeenCalledWith(expect.objectContaining({ view: "grid", sort: "recent" }));
  });

  it("ignores explicitly-undefined input fields (does not overwrite with undefined)", async () => {
    getSettings.mockResolvedValue({ view: "location" } as PantrySettings);

    const result = await resolvers.Mutation.updateSettings(null, { input: { view: undefined } }, ctx());

    expect(result.view).toBe("location");
  });
});

describe("Mutation.syncPricesNow", () => {
  it("checks the rate limiter and triggers the price sync Lambda", async () => {
    const result = await resolvers.Mutation.syncPricesNow(null, {}, ctx({ sourceIp: "2.2.2.2" }));

    expect(assertNotRateLimited).toHaveBeenCalledWith("2.2.2.2");
    expect(triggerPriceSync).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("propagates an error from triggerPriceSync", async () => {
    triggerPriceSync.mockRejectedValue(new Error("no function configured"));

    await expect(resolvers.Mutation.syncPricesNow(null, {}, ctx())).rejects.toThrow("no function configured");
  });
});

describe("Mutation.checkPriceNow", () => {
  it("uses the AI rate limiter (not the CRUD one) and checks/saves an inventory item's price", async () => {
    getItem.mockResolvedValue(inventoryItem({ id: "inv-1", name: "Milk" }));
    checkPrice.mockResolvedValue({ colesPrice: 3.5, productUrl: null, note: null, debugInfo: {} });

    const result = await resolvers.Mutation.checkPriceNow(
      null,
      { id: "inv-1", list: "inventory" },
      ctx({ sourceIp: "3.3.3.3" })
    );

    expect(assertAiNotRateLimited).toHaveBeenCalledWith("3.3.3.3");
    expect(assertNotRateLimited).not.toHaveBeenCalled();
    expect(checkPrice).toHaveBeenCalledWith("Milk", undefined);
    expect(setLastKnownPrice).toHaveBeenCalledWith("inv-1", expect.objectContaining({ colesPrice: 3.5 }));
    expect(setShoppingListLastKnownPrice).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("checks/saves a shopping list entry's price when list is shoppingList", async () => {
    getShoppingListEntry.mockResolvedValue(shoppingListEntry({ id: "sl-1", name: "Eggs" }));
    checkPrice.mockResolvedValue({ colesPrice: 6, productUrl: null, note: null, debugInfo: {} });

    await resolvers.Mutation.checkPriceNow(null, { id: "sl-1", list: "shoppingList" }, ctx());

    expect(checkPrice).toHaveBeenCalledWith("Eggs", undefined);
    expect(setShoppingListLastKnownPrice).toHaveBeenCalledWith(
      "sl-1",
      expect.objectContaining({ colesPrice: 6 })
    );
    expect(setLastKnownPrice).not.toHaveBeenCalled();
  });

  it("throws a descriptive error when the inventory item isn't found", async () => {
    getItem.mockResolvedValue(null);

    await expect(
      resolvers.Mutation.checkPriceNow(null, { id: "missing", list: "inventory" }, ctx())
    ).rejects.toThrow('No inventory item found with id "missing".');
    expect(checkPrice).not.toHaveBeenCalled();
  });

  it("throws a descriptive error when the shopping list entry isn't found", async () => {
    getShoppingListEntry.mockResolvedValue(null);

    await expect(
      resolvers.Mutation.checkPriceNow(null, { id: "missing", list: "shoppingList" }, ctx())
    ).rejects.toThrow('No shopping list entry found with id "missing".');
  });
});
