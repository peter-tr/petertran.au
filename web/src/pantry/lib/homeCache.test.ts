import { afterEach, describe, expect, it, vi } from "vitest";
import { clearPantryHomeCache, readPantryHomeCache, writePantryHomeCache } from "./homeCache";
import { getPantryIdentity } from "./auth";
import type { InventoryItem, PantrySettings, ShoppingListEntry } from "../api";

vi.mock("./auth", () => ({
  getPantryIdentity: vi.fn(() => "guest"),
}));

const mockGetPantryIdentity = vi.mocked(getPantryIdentity);

function makeSettings(): PantrySettings {
  return { view: "list" } as PantrySettings;
}

function makeData() {
  return {
    inventory: [{ id: "1" }] as InventoryItem[],
    shoppingList: [{ id: "s1" }] as ShoppingListEntry[],
    settings: makeSettings(),
  };
}

describe("homeCache", () => {
  afterEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
    mockGetPantryIdentity.mockReturnValue("guest");
  });

  it("returns null when nothing has been cached yet", () => {
    expect(readPantryHomeCache()).toBeNull();
  });

  it("round-trips a write through a read", () => {
    const data = makeData();
    writePantryHomeCache(data);

    expect(readPantryHomeCache()).toEqual(data);
  });

  it("keys the cache by identity, so different accounts don't see each other's cached data", () => {
    mockGetPantryIdentity.mockReturnValue("user-a");
    writePantryHomeCache(makeData());

    mockGetPantryIdentity.mockReturnValue("user-b");
    expect(readPantryHomeCache()).toBeNull();
  });

  it("returns null instead of throwing when the stored value isn't valid JSON", () => {
    mockGetPantryIdentity.mockReturnValue("guest");
    localStorage.setItem("pantry_home_cache_v1_guest", "{not json");

    expect(readPantryHomeCache()).toBeNull();
  });

  it("clearPantryHomeCache removes only the current identity's entry", () => {
    mockGetPantryIdentity.mockReturnValue("user-a");
    writePantryHomeCache(makeData());
    clearPantryHomeCache();

    expect(readPantryHomeCache()).toBeNull();
  });
});
