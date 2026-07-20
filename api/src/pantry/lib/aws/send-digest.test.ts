import { mockClient } from "aws-sdk-client-mock";
import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PantrySettings } from "../../services/settings";
import type { ShoppingListEntry } from "../../services/shopping-list";

const getSettings = vi.fn<() => Promise<PantrySettings>>();
const getShoppingList = vi.fn<() => Promise<ShoppingListEntry[]>>();

vi.mock("../../services/settings", () => ({
  getSettings: () => getSettings(),
}));
vi.mock("../../services/shopping-list", () => ({
  getShoppingList: () => getShoppingList(),
}));

// Imported after the mocks so the module under test picks them up.
const { sendShoppingListDigest } = await import("./send-digest");

const sesMock = mockClient(SESv2Client);

// 2026-01-15T04:00:00Z is 2026-01-15 15:00 in Sydney (AEDT, UTC+11) -
// computed once here so tests are deterministic regardless of when they run,
// without depending on the module's un-exported currentSydneyHour().
const FIXED_NOW = new Date("2026-01-15T04:00:00Z");
const MATCHING_HOUR = 15;

function baseSettings(overrides: Partial<PantrySettings> = {}): PantrySettings {
  return {
    view: "location",
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
    digestHour: MATCHING_HOUR,
    nerdModeInventory: false,
    nerdModeShoppingList: false,
    nerdModeCommandBar: false,
    ...overrides,
  };
}

function entry(overrides: Partial<ShoppingListEntry> = {}): ShoppingListEntry {
  return {
    id: "id-1",
    name: "Milk",
    quantity: 2,
    unit: "L",
    note: null,
    isStaple: false,
    category: "Dairy",
    recipeTag: null,
    urgent: true,
    trackPrice: false,
    lastKnownPrice: null,
    addedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("sendShoppingListDigest", () => {
  const originalFrom = process.env.CONTACT_FROM_EMAIL;
  const originalTo = process.env.CONTACT_TO_EMAIL;

  beforeEach(() => {
    sesMock.reset();
    getSettings.mockReset();
    getShoppingList.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    process.env.CONTACT_FROM_EMAIL = "from@example.com";
    process.env.CONTACT_TO_EMAIL = "to@example.com";
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalFrom === undefined) delete process.env.CONTACT_FROM_EMAIL;
    else process.env.CONTACT_FROM_EMAIL = originalFrom;
    if (originalTo === undefined) delete process.env.CONTACT_TO_EMAIL;
    else process.env.CONTACT_TO_EMAIL = originalTo;
  });

  it("skips silently when CONTACT_FROM_EMAIL is not configured", async () => {
    delete process.env.CONTACT_FROM_EMAIL;

    await sendShoppingListDigest();

    expect(sesMock.calls()).toHaveLength(0);
    expect(getSettings).not.toHaveBeenCalled();
  });

  it("skips silently when CONTACT_TO_EMAIL is not configured", async () => {
    delete process.env.CONTACT_TO_EMAIL;

    await sendShoppingListDigest();

    expect(sesMock.calls()).toHaveLength(0);
  });

  it("skips when digestEnabled is false, without checking the shopping list", async () => {
    getSettings.mockResolvedValue(baseSettings({ digestEnabled: false }));

    await sendShoppingListDigest();

    expect(sesMock.calls()).toHaveLength(0);
    expect(getShoppingList).not.toHaveBeenCalled();
  });

  it("skips when the current Sydney hour doesn't match the configured digestHour", async () => {
    getSettings.mockResolvedValue(baseSettings({ digestHour: (MATCHING_HOUR + 1) % 24 }));

    await sendShoppingListDigest();

    expect(sesMock.calls()).toHaveLength(0);
    expect(getShoppingList).not.toHaveBeenCalled();
  });

  it("skips when there are no urgent items", async () => {
    getSettings.mockResolvedValue(baseSettings());
    getShoppingList.mockResolvedValue([entry({ urgent: false })]);

    await sendShoppingListDigest();

    expect(sesMock.calls()).toHaveLength(0);
  });

  it("sends an email listing only the urgent items when everything matches", async () => {
    getSettings.mockResolvedValue(baseSettings());
    getShoppingList.mockResolvedValue([
      entry({ id: "1", name: "Milk", urgent: true }),
      entry({ id: "2", name: "Butter", urgent: false }),
      entry({ id: "3", name: "Eggs", urgent: true, quantity: null, unit: null, category: null }),
    ]);
    sesMock.on(SendEmailCommand).resolves({ MessageId: "msg-123" });

    await sendShoppingListDigest();

    expect(sesMock.calls()).toHaveLength(1);

    const input = sesMock.call(0).args[0].input as {
      Destination: { ToAddresses: string[] };
      Content: {
        Simple: { Subject: { Data: string }; Body: { Text: { Data: string }; Html: { Data: string } } };
      };
    };
    expect(input.Destination.ToAddresses).toEqual(["to@example.com"]);
    expect(input.Content.Simple.Subject.Data).toBe("Pantry: 2 urgent items to buy");
    expect(input.Content.Simple.Body.Text.Data).toContain("Milk");
    expect(input.Content.Simple.Body.Text.Data).toContain("Eggs");
    expect(input.Content.Simple.Body.Text.Data).not.toContain("Butter");
    expect(input.Content.Simple.Body.Html.Data).toContain("<li>Milk");
  });

  it("uses singular phrasing in the subject for exactly one urgent item", async () => {
    getSettings.mockResolvedValue(baseSettings());
    getShoppingList.mockResolvedValue([entry({ urgent: true })]);
    sesMock.on(SendEmailCommand).resolves({ MessageId: "msg-1" });

    await sendShoppingListDigest();

    const input = sesMock.call(0).args[0].input as { Content: { Simple: { Subject: { Data: string } } } };
    expect(input.Content.Simple.Subject.Data).toBe("Pantry: 1 urgent item to buy");
  });

  it("HTML-escapes entry names/categories to avoid markup injection", async () => {
    getSettings.mockResolvedValue(baseSettings());
    getShoppingList.mockResolvedValue([
      entry({ name: `<script>alert("x")</script>`, category: "A & B", urgent: true }),
    ]);
    sesMock.on(SendEmailCommand).resolves({ MessageId: "msg-1" });

    await sendShoppingListDigest();

    const input = sesMock.call(0).args[0].input as {
      Content: { Simple: { Body: { Html: { Data: string } } } };
    };
    expect(input.Content.Simple.Body.Html.Data).not.toContain("<script>");
    expect(input.Content.Simple.Body.Html.Data).toContain("&lt;script&gt;");
    expect(input.Content.Simple.Body.Html.Data).toContain("A &amp; B");
  });
});
