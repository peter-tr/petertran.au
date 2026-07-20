import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePantryHome } from "./usePantryHome";
import { runPantryQuery } from "../api";
import type { InventoryItem, PantryHomeQueryResult, PantrySettings, ShoppingListEntry } from "../api";

vi.mock("../api", () => ({
  runPantryQuery: vi.fn(),
  PANTRY_HOME_QUERY: "PANTRY_HOME_QUERY",
  UPDATE_SETTINGS_MUTATION: "UPDATE_SETTINGS_MUTATION",
}));

const mockRunPantryQuery = vi.mocked(runPantryQuery);

function makeSettings(overrides: Partial<PantrySettings> = {}): PantrySettings {
  return {
    view: "list",
    sort: "name",
    simple: false,
    optionsCollapsed: false,
    collapsedGroups: [],
    commonItems: [],
    shoppingListCollapsed: false,
    showLowPriority: true,
    categoryFilter: null,
    categories: [],
    addItemDetailsShown: false,
    addItemCollapsed: false,
    commonItemsCollapsed: false,
    shoppingCategoryFilter: null,
    shoppingRecipeFilter: null,
    shoppingUrgentOnly: false,
    shoppingOptionsCollapsed: false,
    shoppingSort: "name",
    shoppingSimple: false,
    digestEnabled: false,
    digestHour: 8,
    nerdModeInventory: false,
    nerdModeShoppingList: false,
    nerdModeCommandBar: false,
    ...overrides,
  };
}

function makeHomeResult(overrides: Partial<PantryHomeQueryResult> = {}): PantryHomeQueryResult {
  return {
    inventory: [] as InventoryItem[],
    shoppingList: [] as ShoppingListEntry[],
    settings: makeSettings(),
    ...overrides,
  } as PantryHomeQueryResult;
}

describe("usePantryHome", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("fetches inventory, shopping list, and settings together on mount", async () => {
    const data = makeHomeResult({
      inventory: [{ id: "1" } as InventoryItem],
      shoppingList: [{ id: "s1" } as ShoppingListEntry],
    });
    mockRunPantryQuery.mockResolvedValueOnce(data);

    const { result } = renderHook(() => usePantryHome());

    expect(result.current.items).toBeNull();
    await waitFor(() => expect(result.current.items).toEqual(data.inventory));
    expect(result.current.shoppingList).toEqual(data.shoppingList);
    expect(result.current.settings).toEqual(data.settings);
    expect(result.current.error).toBeNull();
  });

  it("sets an error message and leaves state null when the initial load fails", async () => {
    mockRunPantryQuery.mockRejectedValueOnce(new Error("offline"));

    const { result } = renderHook(() => usePantryHome());

    await waitFor(() => expect(result.current.error).toBe("offline"));
    expect(result.current.items).toBeNull();
    expect(result.current.shoppingList).toBeNull();
    expect(result.current.settings).toBeNull();
  });

  it("refetch clears a previous error once the retry succeeds", async () => {
    mockRunPantryQuery.mockRejectedValueOnce(new Error("offline"));

    const { result } = renderHook(() => usePantryHome());
    await waitFor(() => expect(result.current.error).toBe("offline"));

    const data = makeHomeResult();
    mockRunPantryQuery.mockResolvedValueOnce(data);
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.items).toEqual(data.inventory);
  });

  it("updateSettings applies an optimistic merge onto the current settings", async () => {
    const data = makeHomeResult({ settings: makeSettings({ view: "list" }) });
    mockRunPantryQuery.mockResolvedValueOnce(data);

    const { result } = renderHook(() => usePantryHome());
    await waitFor(() => expect(result.current.settings).toEqual(data.settings));

    mockRunPantryQuery.mockReturnValueOnce(new Promise(() => {}));
    act(() => {
      result.current.updateSettings({ view: "grid" });
    });

    expect(result.current.settings?.view).toBe("grid");
  });

  it("updateSettings is a no-op on settings when none have loaded yet", () => {
    mockRunPantryQuery.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => usePantryHome());

    act(() => {
      result.current.updateSettings({ view: "grid" });
    });

    expect(result.current.settings).toBeNull();
  });

  it("reports a save error when the settings mutation fails, keeping the optimistic value", async () => {
    const data = makeHomeResult({ settings: makeSettings({ view: "list" }) });
    mockRunPantryQuery.mockResolvedValueOnce(data);

    const { result } = renderHook(() => usePantryHome());
    await waitFor(() => expect(result.current.settings).toEqual(data.settings));

    mockRunPantryQuery.mockRejectedValueOnce(new Error("save failed"));
    await act(async () => {
      result.current.updateSettings({ view: "grid" });
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.error).toBe("save failed"));
    expect(result.current.settings?.view).toBe("grid");
  });
});
