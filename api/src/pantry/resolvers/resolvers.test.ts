import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InventoryItem } from "../services/inventory";
import type { ShoppingListEntry } from "../services/shopping-list";
import type { PantrySettings } from "../services/settings";
import type { PriceSyncStatus } from "../services/price-sync-status";
import type { Context } from "../context";

const assertNotRateLimited = vi.fn<(ip: string | undefined) => Promise<void>>(async () => undefined);
const assertAiNotRateLimited = vi.fn<(ip: string | undefined) => Promise<void>>(async () => undefined);

const getItem = vi.fn<(pk: string, id: string) => Promise<InventoryItem | null>>();
const getAllItems = vi.fn<(pk: string) => Promise<InventoryItem[]>>();
const putItem = vi.fn<(pk: string, item: unknown) => Promise<void>>(async () => undefined);
const deleteItem = vi.fn<(pk: string, id: string) => Promise<boolean>>();
const createItem = vi.fn();
const setLastKnownPrice = vi.fn<(pk: string, id: string, price: unknown) => Promise<void>>(
  async () => undefined
);

const getShoppingListEntry = vi.fn<(pk: string, id: string) => Promise<ShoppingListEntry | null>>();
const getShoppingList = vi.fn<(pk: string) => Promise<ShoppingListEntry[]>>();
const putShoppingListEntry = vi.fn<(pk: string, entry: unknown) => Promise<void>>(async () => undefined);
const deleteShoppingListEntry = vi.fn<(pk: string, id: string) => Promise<boolean>>();
const upsertShoppingListEntry = vi.fn();
const setShoppingListLastKnownPrice = vi.fn<(pk: string, id: string, price: unknown) => Promise<void>>(
  async () => undefined
);

const getSettings = vi.fn<(pk: string) => Promise<PantrySettings>>();
const putSettings = vi.fn<(pk: string, settings: unknown) => Promise<void>>(async () => undefined);

const getPriceSyncStatus = vi.fn<(pk: string) => Promise<PriceSyncStatus>>();
const triggerPriceSync = vi.fn<(pk: string) => Promise<void>>(async () => undefined);

const registerUser = vi.fn<(pk: string, email: string) => Promise<void>>(async () => undefined);

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
  getItem: (pk: string, id: string) => getItem(pk, id),
  getAllItems: (pk: string) => getAllItems(pk),
  putItem: (pk: string, item: unknown) => putItem(pk, item),
  deleteItem: (pk: string, id: string) => deleteItem(pk, id),
  createItem: (input: unknown) => createItem(input),
  setLastKnownPrice: (pk: string, id: string, price: unknown) => setLastKnownPrice(pk, id, price),
}));
vi.mock("../services/shopping-list", () => ({
  getShoppingListEntry: (pk: string, id: string) => getShoppingListEntry(pk, id),
  getShoppingList: (pk: string) => getShoppingList(pk),
  putShoppingListEntry: (pk: string, entry: unknown) => putShoppingListEntry(pk, entry),
  deleteShoppingListEntry: (pk: string, id: string) => deleteShoppingListEntry(pk, id),
  upsertShoppingListEntry: (...args: unknown[]) => upsertShoppingListEntry(...args),
  setShoppingListLastKnownPrice: (pk: string, id: string, price: unknown) =>
    setShoppingListLastKnownPrice(pk, id, price),
}));
vi.mock("../services/settings", () => ({
  getSettings: (pk: string) => getSettings(pk),
  putSettings: (pk: string, settings: unknown) => putSettings(pk, settings),
}));
vi.mock("../services/price-sync-status", () => ({
  getPriceSyncStatus: (pk: string) => getPriceSyncStatus(pk),
}));
vi.mock("../lib/aws/sync-prices", () => ({
  triggerPriceSync: (pk: string) => triggerPriceSync(pk),
}));
vi.mock("../services/users", () => ({
  registerUser: (pk: string, email: string) => registerUser(pk, email),
}));

const { resolvers } = await import("./resolvers");

const TEST_PK = "PANTRY";

function ctx(overrides: Partial<Context> = {}): Context {
  return {
    sourceIp: "1.2.3.4",
    xraySegment: undefined,
    pantryPk: TEST_PK,
    userId: null,
    email: null,
    ...overrides,
  };
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

    const result = await resolvers.Query.inventory(null, {}, ctx());

    expect(result.map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("filters by location when given", async () => {
    getAllItems.mockResolvedValue([
      inventoryItem({ id: "fridge-1", location: "FRIDGE" }),
      inventoryItem({ id: "pantry-1", location: "PANTRY" }),
    ]);

    const result = await resolvers.Query.inventory(null, { location: "PANTRY" }, ctx());

    expect(result.map((i) => i.id)).toEqual(["pantry-1"]);
  });

  it("scopes the lookup to the caller's pantryPk", async () => {
    getAllItems.mockResolvedValue([]);

    await resolvers.Query.inventory(null, {}, ctx({ pantryPk: "USER#abc" }));

    expect(getAllItems).toHaveBeenCalledWith("USER#abc");
  });
});

describe("Query.inventoryItem", () => {
  it("delegates to getItem, scoped to the caller's pantryPk", async () => {
    getItem.mockResolvedValue(inventoryItem({ id: "x" }));

    const result = await resolvers.Query.inventoryItem(null, { id: "x" }, ctx());

    expect(getItem).toHaveBeenCalledWith(TEST_PK, "x");
    expect((result as InventoryItem).id).toBe("x");
  });
});

describe("Query.shoppingList", () => {
  it("returns entries sorted by addedAt ascending", async () => {
    getShoppingList.mockResolvedValue([
      shoppingListEntry({ id: "later", addedAt: "2026-03-01T00:00:00.000Z" }),
      shoppingListEntry({ id: "earlier", addedAt: "2026-01-01T00:00:00.000Z" }),
    ]);

    const result = await resolvers.Query.shoppingList(null, null, ctx());

    expect(result.map((e) => e.id)).toEqual(["earlier", "later"]);
  });
});

describe("Query.settings / priceSyncStatus", () => {
  it("settings delegates to getSettings, scoped to the caller's pantryPk", async () => {
    const settings = { view: "location" } as PantrySettings;
    getSettings.mockResolvedValue(settings);

    await expect(resolvers.Query.settings(null, null, ctx())).resolves.toBe(settings);
    expect(getSettings).toHaveBeenCalledWith(TEST_PK);
  });

  it("priceSyncStatus delegates to getPriceSyncStatus, scoped to the caller's pantryPk", async () => {
    const status = { running: false } as PriceSyncStatus;
    getPriceSyncStatus.mockResolvedValue(status);

    await expect(resolvers.Query.priceSyncStatus(null, null, ctx())).resolves.toBe(status);
    expect(getPriceSyncStatus).toHaveBeenCalledWith(TEST_PK);
  });
});

describe("Query.me", () => {
  it("returns null when unauthenticated (using the default pantry)", () => {
    expect(resolvers.Query.me(null, null, ctx())).toBeNull();
  });

  it("returns the signed-in account's id/email when authenticated", () => {
    const result = resolvers.Query.me(
      null,
      null,
      ctx({ userId: "sub-123", email: "user@example.com", pantryPk: "USER#sub-123" })
    );

    expect(result).toEqual({ id: "sub-123", email: "user@example.com" });
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
  it("checks the rate limiter, then creates and persists the item under the caller's pantryPk", async () => {
    const item = inventoryItem();
    createItem.mockReturnValue(item);

    const result = await resolvers.Mutation.addInventoryItem(
      null,
      { input: { name: "Milk", location: "FRIDGE", quantity: 1 } },
      ctx({ sourceIp: "5.5.5.5" })
    );

    expect(assertNotRateLimited).toHaveBeenCalledWith("5.5.5.5");
    expect(createItem).toHaveBeenCalledWith({ name: "Milk", location: "FRIDGE", quantity: 1 });
    expect(putItem).toHaveBeenCalledWith(TEST_PK, item);
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

    expect(putItem).toHaveBeenCalledWith(TEST_PK, newItem);
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
    expect(putItem).toHaveBeenCalledWith(TEST_PK, expect.objectContaining({ id: "existing", quantity: 3 }));
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
    expect(putItem).toHaveBeenCalledWith(TEST_PK, expect.objectContaining({ quantity: 2, unit: "L" }));
  });
});

describe("Mutation.removeInventoryItem", () => {
  it("also adds a staple item back to the shopping list before deleting it", async () => {
    getItem.mockResolvedValue(inventoryItem({ id: "x", name: "Milk", isStaple: true, category: "Dairy" }));
    deleteItem.mockResolvedValue(true);

    const result = await resolvers.Mutation.removeInventoryItem(null, { id: "x" }, ctx());

    expect(upsertShoppingListEntry).toHaveBeenCalledWith(TEST_PK, "Milk", null, null, null, true, "Dairy");
    expect(deleteItem).toHaveBeenCalledWith(TEST_PK, "x");
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
    expect(upsertShoppingListEntry).toHaveBeenCalledWith(
      TEST_PK,
      "Bread",
      null,
      null,
      null,
      false,
      null,
      null,
      false
    );
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
      TEST_PK,
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
    expect(putShoppingListEntry).toHaveBeenCalledWith(
      TEST_PK,
      expect.objectContaining({ quantity: 2, unit: "g" })
    );
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
    expect(deleteShoppingListEntry).toHaveBeenCalledWith(TEST_PK, "x");
    expect(result).toBe(true);
  });
});

describe("Mutation.updateSettings", () => {
  it("merges only the defined input fields onto the existing settings", async () => {
    getSettings.mockResolvedValue({ view: "location", sort: "recent" } as PantrySettings);

    const result = await resolvers.Mutation.updateSettings(null, { input: { view: "grid" } }, ctx());

    expect(result.view).toBe("grid");
    expect(result.sort).toBe("recent");
    expect(putSettings).toHaveBeenCalledWith(
      TEST_PK,
      expect.objectContaining({ view: "grid", sort: "recent" })
    );
  });

  it("ignores explicitly-undefined input fields (does not overwrite with undefined)", async () => {
    getSettings.mockResolvedValue({ view: "location" } as PantrySettings);

    const result = await resolvers.Mutation.updateSettings(null, { input: { view: undefined } }, ctx());

    expect(result.view).toBe("location");
  });
});

describe("Mutation.syncPricesNow", () => {
  it("checks the rate limiter and triggers the price sync Lambda for the caller's pantryPk", async () => {
    const result = await resolvers.Mutation.syncPricesNow(null, {}, ctx({ sourceIp: "2.2.2.2" }));

    expect(assertNotRateLimited).toHaveBeenCalledWith("2.2.2.2");
    expect(triggerPriceSync).toHaveBeenCalledWith(TEST_PK);
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
    expect(setLastKnownPrice).toHaveBeenCalledWith(
      TEST_PK,
      "inv-1",
      expect.objectContaining({ colesPrice: 3.5 })
    );
    expect(setShoppingListLastKnownPrice).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("checks/saves a shopping list entry's price when list is shoppingList", async () => {
    getShoppingListEntry.mockResolvedValue(shoppingListEntry({ id: "sl-1", name: "Eggs" }));
    checkPrice.mockResolvedValue({ colesPrice: 6, productUrl: null, note: null, debugInfo: {} });

    await resolvers.Mutation.checkPriceNow(null, { id: "sl-1", list: "shoppingList" }, ctx());

    expect(checkPrice).toHaveBeenCalledWith("Eggs", undefined);
    expect(setShoppingListLastKnownPrice).toHaveBeenCalledWith(
      TEST_PK,
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

describe("Mutation.ensureAccount", () => {
  it("throws when not signed in", async () => {
    await expect(resolvers.Mutation.ensureAccount(null, null, ctx())).rejects.toThrow("Not signed in.");
    expect(registerUser).not.toHaveBeenCalled();
  });

  it("registers the signed-in account under its pantryPk and returns it", async () => {
    const result = await resolvers.Mutation.ensureAccount(
      null,
      null,
      ctx({ userId: "sub-123", email: "user@example.com", pantryPk: "USER#sub-123" })
    );

    expect(registerUser).toHaveBeenCalledWith("USER#sub-123", "user@example.com");
    expect(result).toEqual({ id: "sub-123", email: "user@example.com" });
  });
});
