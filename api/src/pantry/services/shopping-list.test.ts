import { mockClient } from "aws-sdk-client-mock";
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it } from "vitest";
import { ddb, PK } from "../lib/aws/ddb";
import { UNKNOWN_DEBUG_INFO } from "./inventory";
import {
  getShoppingListEntry,
  getShoppingList,
  putShoppingListEntry,
  setShoppingListLastKnownPrice,
  upsertShoppingListEntry,
  type ShoppingListEntry,
} from "./shopping-list";

const ddbMock = mockClient(ddb);

// A row shaped the way it would have been written before isStaple, urgent,
// trackPrice, and lastKnownPrice.debugInfo existed - see CLAUDE.md's
// non-nullable GraphQL field guidance and withShoppingListDefaults's comment.
function oldShapedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "entry-1",
    name: "Eggs",
    quantity: 1,
    unit: "dozen",
    note: null,
    category: null,
    recipeTag: null,
    addedAt: "2026-01-01T00:00:00.000Z",
    // isStaple, urgent, trackPrice, lastKnownPrice deliberately omitted.
    ...overrides,
  };
}

describe("getShoppingListEntry backfill", () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it("backfills isStaple/urgent/trackPrice to false on an old-shaped row", async () => {
    ddbMock.on(GetCommand).resolves({ Item: { data: oldShapedRow() } });

    const entry = await getShoppingListEntry("entry-1");

    expect(entry).not.toBeNull();
    expect(entry!.isStaple).toBe(false);
    expect(entry!.urgent).toBe(false);
    expect(entry!.trackPrice).toBe(false);
    expect(entry!.lastKnownPrice).toBeNull();
  });

  it("preserves true booleans already stored", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { data: oldShapedRow({ isStaple: true, urgent: true, trackPrice: true }) },
    });

    const entry = await getShoppingListEntry("entry-1");

    expect(entry!.isStaple).toBe(true);
    expect(entry!.urgent).toBe(true);
    expect(entry!.trackPrice).toBe(true);
  });

  it("backfills quantity/unit/note/category/recipeTag to null when missing", async () => {
    const bareRow = { id: "entry-1", name: "Eggs", addedAt: "2026-01-01T00:00:00.000Z" };
    ddbMock.on(GetCommand).resolves({ Item: { data: bareRow } });

    const entry = await getShoppingListEntry("entry-1");

    expect(entry).toMatchObject({
      quantity: null,
      unit: null,
      note: null,
      category: null,
      recipeTag: null,
      isStaple: false,
      urgent: false,
      trackPrice: false,
      lastKnownPrice: null,
    });
  });

  it("backfills a missing lastKnownPrice.debugInfo with UNKNOWN_DEBUG_INFO", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        data: oldShapedRow({
          lastKnownPrice: { colesPrice: 5, productUrl: null, note: null, checkedAt: "2026-01-05" },
        }),
      },
    });

    const entry = await getShoppingListEntry("entry-1");

    expect(entry!.lastKnownPrice).toEqual({
      colesPrice: 5,
      productUrl: null,
      note: null,
      checkedAt: "2026-01-05",
      debugInfo: UNKNOWN_DEBUG_INFO,
    });
  });

  it("returns null when nothing is stored", async () => {
    ddbMock.on(GetCommand).resolves({});

    await expect(getShoppingListEntry("missing")).resolves.toBeNull();
  });
});

describe("getShoppingList backfill (used by the digest Lambda too)", () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it("backfills defaults across every entry from the query", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ data: oldShapedRow({ id: "a" }) }, { data: oldShapedRow({ id: "b", urgent: true }) }],
    });

    const entries = await getShoppingList();

    expect(entries).toHaveLength(2);
    expect(entries[0].urgent).toBe(false);
    expect(entries[1].urgent).toBe(true);
  });

  it("queries under the SHOPLIST# prefix within the pantry partition", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    await getShoppingList();

    const input = ddbMock.call(0).args[0].input as { ExpressionAttributeValues: Record<string, string> };
    expect(input.ExpressionAttributeValues).toEqual({ ":pk": PK, ":prefix": "SHOPLIST#" });
  });
});

describe("putShoppingListEntry", () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it("writes under the SHOPLIST# prefix", async () => {
    ddbMock.on(PutCommand).resolves({});

    const entry: ShoppingListEntry = {
      id: "entry-9",
      name: "Bread",
      quantity: null,
      unit: null,
      note: null,
      isStaple: false,
      category: null,
      recipeTag: null,
      urgent: false,
      trackPrice: false,
      lastKnownPrice: null,
      addedAt: "2026-01-01T00:00:00.000Z",
    };

    await putShoppingListEntry(entry);

    const input = ddbMock.call(0).args[0].input as { Item: { sk: string; type: string } };
    expect(input.Item.sk).toBe("SHOPLIST#entry-9");
    expect(input.Item.type).toBe("SHOPLIST");
  });
});

describe("setShoppingListLastKnownPrice", () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it("throws when the entry doesn't exist", async () => {
    ddbMock.on(GetCommand).resolves({});

    await expect(
      setShoppingListLastKnownPrice("missing", {
        colesPrice: 1,
        productUrl: null,
        note: null,
        checkedAt: "now",
        debugInfo: UNKNOWN_DEBUG_INFO,
      })
    ).rejects.toThrow('No shopping list entry found with id "missing".');
  });

  it("merges the new price into the existing entry", async () => {
    ddbMock.on(GetCommand).resolves({ Item: { data: oldShapedRow() } });
    ddbMock.on(PutCommand).resolves({});

    const price = {
      colesPrice: 6.5,
      productUrl: "https://www.coles.com.au/product/eggs-1",
      note: null,
      checkedAt: "2026-02-01",
      debugInfo: UNKNOWN_DEBUG_INFO,
    };

    await setShoppingListLastKnownPrice("entry-1", price);

    const putInput = ddbMock.commandCalls(PutCommand)[0].args[0].input as {
      Item: { data: ShoppingListEntry };
    };
    expect(putInput.Item.data.lastKnownPrice).toEqual(price);
    expect(putInput.Item.data.name).toBe("Eggs");
  });
});

describe("upsertShoppingListEntry", () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it("creates a new entry when no existing item matches (case/pluralization-insensitive)", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    ddbMock.on(PutCommand).resolves({});

    const entry = await upsertShoppingListEntry(
      "Milk",
      2,
      "liters",
      "for pancakes",
      true,
      "Dairy",
      "Pancakes",
      true
    );

    expect(entry.name).toBe("Milk");
    expect(entry.quantity).toBe(2);
    expect(entry.unit).toBe("L");
    expect(entry.note).toBe("for pancakes");
    expect(entry.isStaple).toBe(true);
    expect(entry.category).toBe("Dairy");
    expect(entry.recipeTag).toBe("Pancakes");
    expect(entry.urgent).toBe(true);
    expect(entry.trackPrice).toBe(false);
    expect(entry.lastKnownPrice).toBeNull();
  });

  it("merges into an existing entry matched by normalized name instead of creating a duplicate", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ data: oldShapedRow({ id: "existing", name: "Eggs", quantity: 1, unit: "dozen" }) }],
    });
    ddbMock.on(PutCommand).resolves({});

    // "eggs" (plural) normalizes to the same needle as stored "Eggs".
    const entry = await upsertShoppingListEntry("eggs", 2, "dozen");

    expect(entry.id).toBe("existing");
    expect(entry.quantity).toBe(2);
  });

  it("only ever upgrades isStaple/urgent to true, never back to false on a later unrelated upsert", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ data: oldShapedRow({ id: "existing", isStaple: true, urgent: true }) }],
    });
    ddbMock.on(PutCommand).resolves({});

    const entry = await upsertShoppingListEntry("Eggs", null, null, null, false, null, null, false);

    expect(entry.isStaple).toBe(true);
    expect(entry.urgent).toBe(true);
  });

  it("falls back to the existing quantity/unit/note/category/recipeTag when not given", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          data: oldShapedRow({
            id: "existing",
            quantity: 3,
            unit: "kg",
            note: "keep",
            category: "Meat",
            recipeTag: "Stew",
          }),
        },
      ],
    });
    ddbMock.on(PutCommand).resolves({});

    const entry = await upsertShoppingListEntry("Eggs", null, null, null);

    expect(entry.quantity).toBe(3);
    expect(entry.unit).toBe("kg");
    expect(entry.note).toBe("keep");
    expect(entry.category).toBe("Meat");
    expect(entry.recipeTag).toBe("Stew");
  });
});
