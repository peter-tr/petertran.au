import { mockClient } from "aws-sdk-client-mock";
import { GetCommand, PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it } from "vitest";
import { ddb, PK } from "../lib/aws/ddb";
import {
  getItem,
  getAllItems,
  putItem,
  deleteItem,
  createItem,
  setLastKnownPrice,
  UNKNOWN_DEBUG_INFO,
  type InventoryItem,
} from "./inventory";

const ddbMock = mockClient(ddb);

// A row shaped the way it would have been written before isStaple,
// lowPriority, nearlyEmpty, trackPrice, and lastKnownPrice.debugInfo
// existed - simulates real pre-migration data (see CLAUDE.md's non-nullable
// GraphQL field guidance, and withInventoryDefaults's own comment).
function oldShapedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    name: "Milk",
    category: "Dairy",
    location: "FRIDGE",
    quantity: 2,
    unit: "L",
    price: 4.5,
    purchasedAt: "2026-01-01",
    expiresAt: null,
    purchases: [],
    addedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    // isStaple, lowPriority, nearlyEmpty, trackPrice, lastKnownPrice
    // deliberately omitted.
    ...overrides,
  };
}

describe("getItem backfill", () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it("backfills isStaple/lowPriority/nearlyEmpty/trackPrice to false on an old-shaped row", async () => {
    ddbMock.on(GetCommand).resolves({ Item: { data: oldShapedRow() } });

    const item = await getItem("item-1");

    expect(item).not.toBeNull();
    expect(item!.isStaple).toBe(false);
    expect(item!.lowPriority).toBe(false);
    expect(item!.nearlyEmpty).toBe(false);
    expect(item!.trackPrice).toBe(false);
    expect(item!.lastKnownPrice).toBeNull();
  });

  it("preserves true booleans already stored, rather than always defaulting to false", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        data: oldShapedRow({ isStaple: true, lowPriority: true, nearlyEmpty: true, trackPrice: true }),
      },
    });

    const item = await getItem("item-1");

    expect(item!.isStaple).toBe(true);
    expect(item!.lowPriority).toBe(true);
    expect(item!.nearlyEmpty).toBe(true);
    expect(item!.trackPrice).toBe(true);
  });

  it("backfills a missing lastKnownPrice.debugInfo with UNKNOWN_DEBUG_INFO instead of dropping the whole price", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        data: oldShapedRow({
          lastKnownPrice: { colesPrice: 3.5, productUrl: null, note: null, checkedAt: "2026-01-05" },
        }),
      },
    });

    const item = await getItem("item-1");

    expect(item!.lastKnownPrice).toEqual({
      colesPrice: 3.5,
      productUrl: null,
      note: null,
      checkedAt: "2026-01-05",
      debugInfo: UNKNOWN_DEBUG_INFO,
    });
  });

  it("preserves an existing debugInfo rather than overwriting it", async () => {
    const debugInfo = { costUsd: 0.01, durationMs: 500, searchesUsed: 1, fetchesUsed: 1 };
    ddbMock.on(GetCommand).resolves({
      Item: {
        data: oldShapedRow({
          lastKnownPrice: {
            colesPrice: 3.5,
            productUrl: null,
            note: null,
            checkedAt: "2026-01-05",
            debugInfo,
          },
        }),
      },
    });

    const item = await getItem("item-1");

    expect(item!.lastKnownPrice!.debugInfo).toEqual(debugInfo);
  });

  it("returns null when nothing is stored", async () => {
    ddbMock.on(GetCommand).resolves({});

    await expect(getItem("missing")).resolves.toBeNull();
  });
});

describe("getAllItems backfill", () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it("backfills defaults on every item in the query results, even when some are old-shaped and some aren't", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { data: oldShapedRow({ id: "old" }) },
        {
          data: oldShapedRow({
            id: "new",
            isStaple: true,
            lowPriority: false,
            nearlyEmpty: false,
            trackPrice: false,
          }),
        },
      ],
    });

    const items = await getAllItems();

    expect(items).toHaveLength(2);
    expect(items[0].isStaple).toBe(false);
    expect(items[1].isStaple).toBe(true);
  });

  it("queries under the ITEM# prefix within the pantry partition", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    await getAllItems();

    const input = ddbMock.call(0).args[0].input as {
      ExpressionAttributeValues: Record<string, string>;
    };
    expect(input.ExpressionAttributeValues).toEqual({ ":pk": PK, ":prefix": "ITEM#" });
  });
});

describe("putItem / deleteItem", () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it("putItem writes under the ITEM# prefix", async () => {
    ddbMock.on(PutCommand).resolves({});

    const item = createItem({ name: "Bread", location: "PANTRY", quantity: 1 });

    await putItem(item);

    const input = ddbMock.call(0).args[0].input as { Item: { sk: string; type: string } };
    expect(input.Item.sk).toBe(`ITEM#${item.id}`);
    expect(input.Item.type).toBe("ITEM");
  });

  it("deleteItem returns whether anything was actually deleted", async () => {
    ddbMock.on(DeleteCommand).resolves({ Attributes: { id: "x" } });

    await expect(deleteItem("x")).resolves.toBe(true);
  });
});

describe("setLastKnownPrice", () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it("throws when the item doesn't exist", async () => {
    ddbMock.on(GetCommand).resolves({});

    await expect(
      setLastKnownPrice("missing", {
        colesPrice: 1,
        productUrl: null,
        note: null,
        checkedAt: "now",
        debugInfo: UNKNOWN_DEBUG_INFO,
      })
    ).rejects.toThrow('No inventory item found with id "missing".');
  });

  it("merges the new price into the existing item and writes it back", async () => {
    ddbMock.on(GetCommand).resolves({ Item: { data: oldShapedRow() } });
    ddbMock.on(PutCommand).resolves({});

    const price = {
      colesPrice: 9.99,
      productUrl: "https://www.coles.com.au/product/milk-123",
      note: null,
      checkedAt: "2026-02-01",
      debugInfo: UNKNOWN_DEBUG_INFO,
    };

    await setLastKnownPrice("item-1", price);

    const putInput = ddbMock.commandCalls(PutCommand)[0].args[0].input as { Item: { data: InventoryItem } };
    expect(putInput.Item.data.lastKnownPrice).toEqual(price);
    expect(putInput.Item.data.name).toBe("Milk");
  });
});

describe("createItem", () => {
  it("fills in defaults for a bare-minimum input", () => {
    const item = createItem({ name: "Salt", location: "PANTRY", quantity: 1 });

    expect(item.category).toBeNull();
    expect(item.unit).toBeNull();
    expect(item.price).toBeNull();
    expect(item.isStaple).toBe(false);
    expect(item.lowPriority).toBe(false);
    expect(item.nearlyEmpty).toBe(false);
    expect(item.trackPrice).toBe(false);
    expect(item.lastKnownPrice).toBeNull();
    expect(item.purchases).toEqual([]);
    expect(item.id).toBeTruthy();
    expect(item.addedAt).toBe(item.updatedAt);
  });

  it("normalizes the unit via normalizeUnit", () => {
    const item = createItem({ name: "Milk", location: "FRIDGE", quantity: 1, unit: "liters" });

    expect(item.unit).toBe("L");
  });

  it("logs an initial purchase batch only when purchasedAt is given", () => {
    const withDate = createItem({
      name: "Milk",
      location: "FRIDGE",
      quantity: 2,
      price: 4,
      purchasedAt: "2026-01-01",
    });
    expect(withDate.purchases).toEqual([{ date: "2026-01-01", price: 4, quantity: 2 }]);

    const withoutDate = createItem({ name: "Milk", location: "FRIDGE", quantity: 2 });
    expect(withoutDate.purchases).toEqual([]);
  });

  it("respects explicit isStaple/lowPriority/nearlyEmpty/trackPrice flags", () => {
    const item = createItem({
      name: "Rice",
      location: "PANTRY",
      quantity: 1,
      isStaple: true,
      lowPriority: true,
      nearlyEmpty: true,
      trackPrice: true,
    });

    expect(item.isStaple).toBe(true);
    expect(item.lowPriority).toBe(true);
    expect(item.nearlyEmpty).toBe(true);
    expect(item.trackPrice).toBe(true);
  });
});
