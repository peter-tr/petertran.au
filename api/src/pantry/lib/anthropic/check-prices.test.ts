import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InventoryItem, LastKnownPrice } from "../../services/inventory";
import type { ShoppingListEntry } from "../../services/shopping-list";

const messagesParse = vi.fn();
const getAnthropicClient = vi.fn(async () => ({ messages: { parse: messagesParse } }));

const getAllItems = vi.fn<() => Promise<InventoryItem[]>>();
const setLastKnownPrice = vi.fn<(id: string, price: LastKnownPrice) => Promise<void>>();
const getShoppingList = vi.fn<() => Promise<ShoppingListEntry[]>>();
const setShoppingListLastKnownPrice = vi.fn<(id: string, price: LastKnownPrice) => Promise<void>>();
const startPriceSync = vi.fn();
const recordPriceCheckProgress = vi.fn();
const finishPriceSync = vi.fn();

vi.mock("api-shared/anthropic-client", () => ({
  getAnthropicClient: () => getAnthropicClient(),
}));
vi.mock("api-shared/xray", () => ({
  traced: (_name: string, fn: () => unknown) => fn(),
  ANTHROPIC_API_SEGMENT_NAME: "Anthropic API",
}));
vi.mock("../../services/inventory", () => ({
  getAllItems: () => getAllItems(),
  setLastKnownPrice: (id: string, price: LastKnownPrice) => setLastKnownPrice(id, price),
}));
vi.mock("../../services/shopping-list", () => ({
  getShoppingList: () => getShoppingList(),
  setShoppingListLastKnownPrice: (id: string, price: LastKnownPrice) =>
    setShoppingListLastKnownPrice(id, price),
}));
vi.mock("../../services/price-sync-status", () => ({
  startPriceSync: (n: number) => startPriceSync(n),
  recordPriceCheckProgress: (e?: unknown) => recordPriceCheckProgress(e),
  finishPriceSync: () => finishPriceSync(),
}));

const { checkPrice, checkTrackedPrices } = await import("./check-prices");

function usage(overrides: Partial<{ input_tokens: number; output_tokens: number }> = {}) {
  return { input_tokens: 100, output_tokens: 50, ...overrides };
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
    trackPrice: true,
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
    trackPrice: true,
    lastKnownPrice: null,
    addedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("checkPrice", () => {
  beforeEach(() => {
    messagesParse.mockReset();
    getAnthropicClient.mockClear();
  });

  it("returns the matched result for the single item requested", async () => {
    messagesParse.mockResolvedValue({
      usage: usage(),
      parsed_output: {
        results: [
          {
            name: "Milk",
            colesPrice: 3.5,
            productUrl: "https://www.coles.com.au/product/milk-2l",
            note: "2L standard",
          },
        ],
      },
    });

    const result = await checkPrice("Milk", undefined);

    expect(result.colesPrice).toBe(3.5);
    expect(result.productUrl).toBe("https://www.coles.com.au/product/milk-2l");
    expect(result.note).toBe("2L standard");
    expect(result.debugInfo.costUsd).toBeGreaterThan(0);
  });

  it("returns nulls when the batch response has no entry for the requested name", async () => {
    messagesParse.mockResolvedValue({ usage: usage(), parsed_output: { results: [] } });

    const result = await checkPrice("Milk", undefined);

    expect(result.colesPrice).toBeNull();
    expect(result.productUrl).toBeNull();
    expect(result.note).toBeNull();
  });

  it("nulls out a productUrl that isn't a real Coles product URL", async () => {
    messagesParse.mockResolvedValue({
      usage: usage(),
      parsed_output: {
        results: [{ name: "Milk", colesPrice: 3.5, productUrl: "https://example.com/not-coles", note: null }],
      },
    });

    const result = await checkPrice("Milk", undefined);

    expect(result.productUrl).toBeNull();
  });

  it("strips trailing punctuation from a productUrl before validating it", async () => {
    messagesParse.mockResolvedValue({
      usage: usage(),
      parsed_output: {
        results: [
          {
            name: "Milk",
            colesPrice: 3.5,
            productUrl: "https://www.coles.com.au/product/milk-2l).",
            note: null,
          },
        ],
      },
    });

    const result = await checkPrice("Milk", undefined);

    expect(result.productUrl).toBe("https://www.coles.com.au/product/milk-2l");
  });

  it("handles a null parsed_output by returning nulls rather than throwing", async () => {
    messagesParse.mockResolvedValue({ usage: usage(), parsed_output: null });

    const result = await checkPrice("Milk", undefined);

    expect(result.colesPrice).toBeNull();
  });
});

describe("checkTrackedPrices", () => {
  beforeEach(() => {
    messagesParse.mockReset();
    getAllItems.mockReset();
    setLastKnownPrice.mockReset();
    getShoppingList.mockReset();
    setShoppingListLastKnownPrice.mockReset();
    startPriceSync.mockReset();
    recordPriceCheckProgress.mockReset();
    finishPriceSync.mockReset();
  });

  it("skips entirely (no sync started) when nothing is trackPrice", async () => {
    getAllItems.mockResolvedValue([inventoryItem({ trackPrice: false })]);
    getShoppingList.mockResolvedValue([shoppingListEntry({ trackPrice: false })]);

    await checkTrackedPrices(undefined);

    expect(startPriceSync).not.toHaveBeenCalled();
    expect(messagesParse).not.toHaveBeenCalled();
  });

  it("checks both trackPrice inventory items and shopping list entries in one batch", async () => {
    getAllItems.mockResolvedValue([inventoryItem({ id: "inv-1", name: "Milk", trackPrice: true })]);
    getShoppingList.mockResolvedValue([shoppingListEntry({ id: "sl-1", name: "Eggs", trackPrice: true })]);
    messagesParse.mockResolvedValue({
      usage: usage(),
      parsed_output: {
        results: [
          { name: "Milk", colesPrice: 3.5, productUrl: null, note: null },
          { name: "Eggs", colesPrice: 6, productUrl: null, note: null },
        ],
      },
    });

    await checkTrackedPrices(undefined);

    expect(startPriceSync).toHaveBeenCalledWith(2);
    expect(setLastKnownPrice).toHaveBeenCalledWith("inv-1", expect.objectContaining({ colesPrice: 3.5 }));
    expect(setShoppingListLastKnownPrice).toHaveBeenCalledWith(
      "sl-1",
      expect.objectContaining({ colesPrice: 6 })
    );
    expect(finishPriceSync).toHaveBeenCalledTimes(1);
    // Two successful checks, no errors.
    expect(recordPriceCheckProgress).toHaveBeenCalledTimes(2);
    expect(recordPriceCheckProgress).toHaveBeenCalledWith(undefined);
  });

  it("caps the number of tracked targets processed at MAX_ITEMS_PER_RUN (20)", async () => {
    const items = Array.from({ length: 25 }, (_, i) =>
      inventoryItem({ id: `inv-${i}`, name: `Item ${i}`, trackPrice: true })
    );
    getAllItems.mockResolvedValue(items);
    getShoppingList.mockResolvedValue([]);
    messagesParse.mockResolvedValue({ usage: usage(), parsed_output: { results: [] } });

    await checkTrackedPrices(undefined);

    expect(startPriceSync).toHaveBeenCalledWith(20);

    // Only 20 items should have been asked about in the prompt.
    const call = messagesParse.mock.calls[0][0];
    const userMessage = call.messages[0].content as string;
    const requestedCount = (userMessage.match(/^- /gm) ?? []).length;
    expect(requestedCount).toBe(20);
  });

  it("records a per-target error and still finishes when the whole batch call throws", async () => {
    getAllItems.mockResolvedValue([inventoryItem({ id: "inv-1", name: "Milk", trackPrice: true })]);
    getShoppingList.mockResolvedValue([]);
    messagesParse.mockRejectedValue(new Error("Anthropic API down"));

    await checkTrackedPrices(undefined);

    expect(recordPriceCheckProgress).toHaveBeenCalledWith(
      expect.objectContaining({ itemName: "Milk", message: "Anthropic API down" })
    );
    expect(setLastKnownPrice).not.toHaveBeenCalled();
    expect(finishPriceSync).toHaveBeenCalledTimes(1);
  });

  it("records a missing-result error when a target isn't present in the batch response", async () => {
    getAllItems.mockResolvedValue([inventoryItem({ id: "inv-1", name: "Milk", trackPrice: true })]);
    getShoppingList.mockResolvedValue([]);
    messagesParse.mockResolvedValue({ usage: usage(), parsed_output: { results: [] } });

    await checkTrackedPrices(undefined);

    expect(recordPriceCheckProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        itemName: "Milk",
        message: "No result returned for this item in the batch response.",
      })
    );
    expect(setLastKnownPrice).not.toHaveBeenCalled();
  });

  it("records a per-target error (without aborting the rest) when applying a price throws", async () => {
    getAllItems.mockResolvedValue([inventoryItem({ id: "inv-1", name: "Milk", trackPrice: true })]);
    getShoppingList.mockResolvedValue([]);
    messagesParse.mockResolvedValue({
      usage: usage(),
      parsed_output: { results: [{ name: "Milk", colesPrice: 3.5, productUrl: null, note: null }] },
    });
    setLastKnownPrice.mockRejectedValue(new Error("write failed"));

    await checkTrackedPrices(undefined);

    expect(recordPriceCheckProgress).toHaveBeenCalledWith(
      expect.objectContaining({ itemName: "Milk", message: "write failed" })
    );
    expect(finishPriceSync).toHaveBeenCalledTimes(1);
  });

  it("splits the batch's cost/duration evenly across every target (nerd-mode fairness)", async () => {
    getAllItems.mockResolvedValue([
      inventoryItem({ id: "inv-1", name: "Milk", trackPrice: true }),
      inventoryItem({ id: "inv-2", name: "Bread", trackPrice: true }),
    ]);
    getShoppingList.mockResolvedValue([]);
    messagesParse.mockResolvedValue({
      usage: { input_tokens: 2_000_000, output_tokens: 0 }, // $2 total cost
      parsed_output: {
        results: [
          { name: "Milk", colesPrice: 3.5, productUrl: null, note: null },
          { name: "Bread", colesPrice: 4, productUrl: null, note: null },
        ],
      },
    });

    await checkTrackedPrices(undefined);

    const [, price1] = setLastKnownPrice.mock.calls[0];
    const [, price2] = setLastKnownPrice.mock.calls[1];
    expect(price1.debugInfo.costUsd).toBeCloseTo(1, 10);
    expect(price2.debugInfo.costUsd).toBeCloseTo(1, 10);
  });
});
