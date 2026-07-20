import { mockClient } from "aws-sdk-client-mock";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it } from "vitest";
import { ddb, PK } from "../lib/aws/ddb";
import { getSettings, putSettings, type PantrySettings } from "./settings";

const ddbMock = mockClient(ddb);

describe("getSettings", () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it("returns all defaults when nothing is stored", async () => {
    ddbMock.on(GetCommand).resolves({});

    const settings = await getSettings();

    expect(settings.view).toBe("location");
    expect(settings.digestEnabled).toBe(true);
    expect(settings.digestHour).toBe(16);
    expect(settings.commonItems.length).toBeGreaterThan(0);
    expect(settings.categories.length).toBeGreaterThan(0);
    expect(settings.nerdModeInventory).toBe(false);
  });

  it("reads from the fixed SETTINGS sort key under the pantry partition key", async () => {
    ddbMock.on(GetCommand).resolves({});

    await getSettings();

    const input = ddbMock.call(0).args[0].input as { Key: { pk: string; sk: string } };
    expect(input.Key).toEqual({ pk: PK, sk: "SETTINGS" });
  });

  // This is the exact class of production outage documented in CLAUDE.md:
  // a settings row saved before a new non-nullable field existed (here,
  // `sort`, `digestEnabled`/`digestHour`, and the three nerd-mode flags)
  // must still produce a fully-populated object on read, or GraphQL
  // null-propagates the whole field and fails the containing query.
  it("backfills missing fields on an old-shaped stored row via the DEFAULT_SETTINGS merge", async () => {
    const oldShapedRow: Partial<PantrySettings> = {
      view: "grid",
      simple: true,
      collapsedGroups: ["Dairy"],
      commonItems: ["Milk"],
      // Deliberately omitted: sort, categories, digestEnabled, digestHour,
      // nerdModeInventory/nerdModeShoppingList/nerdModeCommandBar, and
      // several others - simulating a row written before those existed.
    };
    ddbMock.on(GetCommand).resolves({ Item: { pk: PK, sk: "SETTINGS", data: oldShapedRow } });

    const settings = await getSettings();

    // Stored fields win...
    expect(settings.view).toBe("grid");
    expect(settings.simple).toBe(true);
    expect(settings.collapsedGroups).toEqual(["Dairy"]);
    expect(settings.commonItems).toEqual(["Milk"]);
    // ...but every field missing from the stored row is backfilled from
    // DEFAULT_SETTINGS rather than coming back undefined.
    expect(settings.sort).toBe("recent");
    expect(settings.digestEnabled).toBe(true);
    expect(settings.digestHour).toBe(16);
    expect(settings.nerdModeInventory).toBe(false);
    expect(settings.nerdModeShoppingList).toBe(false);
    expect(settings.nerdModeCommandBar).toBe(false);
    expect(settings.categories.length).toBeGreaterThan(0);
    expect(settings.categoryFilter).toBeNull();
    expect(settings.shoppingSort).toBe("recent");
  });

  it("backfills even when the stored row is a bare empty object", async () => {
    ddbMock.on(GetCommand).resolves({ Item: { pk: PK, sk: "SETTINGS", data: {} } });

    const settings = await getSettings();

    expect(settings.view).toBe("location");
    expect(settings.digestHour).toBe(16);
  });

  it("lets an explicit false/0/null stored value override the default (merge is shallow, not per-field-truthy)", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { pk: PK, sk: "SETTINGS", data: { digestEnabled: false, digestHour: 0, categoryFilter: null } },
    });

    const settings = await getSettings();

    expect(settings.digestEnabled).toBe(false);
    expect(settings.digestHour).toBe(0);
  });
});

describe("putSettings", () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it("writes the full settings object under the fixed SETTINGS key with type SETTINGS", async () => {
    ddbMock.on(PutCommand).resolves({});
    const settings: PantrySettings = {
      view: "grid",
      sort: "recent",
      simple: false,
      optionsCollapsed: false,
      collapsedGroups: [],
      commonItems: [],
      shoppingListCollapsed: false,
      showLowPriority: false,
      categoryFilter: null,
      categories: [],
      addItemDetailsShown: false,
      addItemCollapsed: false,
      commonItemsCollapsed: false,
      shoppingCategoryFilter: null,
      shoppingRecipeFilter: null,
      shoppingUrgentOnly: false,
      shoppingOptionsCollapsed: false,
      shoppingSort: "recent",
      shoppingSimple: false,
      digestEnabled: true,
      digestHour: 16,
      nerdModeInventory: false,
      nerdModeShoppingList: false,
      nerdModeCommandBar: false,
    };

    await putSettings(settings);

    expect(ddbMock.calls()).toHaveLength(1);
    const input = ddbMock.call(0).args[0].input as {
      Item: { pk: string; sk: string; type: string; data: PantrySettings };
    };
    expect(input.Item.pk).toBe(PK);
    expect(input.Item.sk).toBe("SETTINGS");
    expect(input.Item.type).toBe("SETTINGS");
    expect(input.Item.data).toEqual(settings);
  });
});
