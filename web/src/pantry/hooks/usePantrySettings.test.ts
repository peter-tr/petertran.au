import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mergeSettings, usePantrySettings } from "./usePantrySettings";
import { runPantryQuery } from "../api";
import type { PantrySettings, PantrySettingsInput } from "../api";

vi.mock("../api", () => ({
  runPantryQuery: vi.fn(),
  SETTINGS_QUERY: "SETTINGS_QUERY",
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

describe("mergeSettings", () => {
  it("overwrites fields present with non-null/non-undefined values", () => {
    const prev = makeSettings({ view: "list", digestHour: 8 });
    const next = mergeSettings(prev, { view: "grid", digestHour: 20 });
    expect(next.view).toBe("grid");
    expect(next.digestHour).toBe(20);
  });

  it("skips a key whose value is explicitly null, keeping the previous value", () => {
    const prev = makeSettings({ categoryFilter: "Dairy" });
    const next = mergeSettings(prev, { categoryFilter: null } as PantrySettingsInput);
    expect(next.categoryFilter).toBe("Dairy");
  });

  it("skips a key whose value is undefined", () => {
    const prev = makeSettings({ view: "list" });
    const next = mergeSettings(prev, { view: undefined } as PantrySettingsInput);
    expect(next.view).toBe("list");
  });

  it("does not mutate the previous settings object", () => {
    const prev = makeSettings({ view: "list" });
    const next = mergeSettings(prev, { view: "grid" });
    expect(prev.view).toBe("list");
    expect(next).not.toBe(prev);
  });

  it("applies false and 0 as real values, not treated as absent", () => {
    const prev = makeSettings({ simple: true, digestHour: 8 });
    const next = mergeSettings(prev, { simple: false, digestHour: 0 });
    expect(next.simple).toBe(false);
    expect(next.digestHour).toBe(0);
  });

  it("leaves fields not mentioned in the partial untouched", () => {
    const prev = makeSettings({ view: "list", sort: "name" });
    const next = mergeSettings(prev, { view: "grid" });
    expect(next.sort).toBe("name");
  });
});

describe("usePantrySettings", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("loads settings on mount", async () => {
    const settings = makeSettings({ view: "list" });
    mockRunPantryQuery.mockResolvedValueOnce({ settings });

    const { result } = renderHook(() => usePantrySettings());

    expect(result.current.settings).toBeNull();
    await waitFor(() => expect(result.current.settings).toEqual(settings));
    expect(result.current.error).toBeNull();
  });

  it("sets an error message when the initial load fails", async () => {
    mockRunPantryQuery.mockRejectedValueOnce(new Error("network down"));

    const { result } = renderHook(() => usePantrySettings());

    await waitFor(() => expect(result.current.error).toBe("network down"));
    expect(result.current.settings).toBeNull();
  });

  it("falls back to a generic error message for a non-Error rejection", async () => {
    mockRunPantryQuery.mockRejectedValueOnce("boom");

    const { result } = renderHook(() => usePantrySettings());

    await waitFor(() => expect(result.current.error).toBe("Failed to load"));
  });

  it("applies updateSettings optimistically before the mutation resolves", async () => {
    const settings = makeSettings({ view: "list" });
    mockRunPantryQuery.mockResolvedValueOnce({ settings });

    const { result } = renderHook(() => usePantrySettings());
    await waitFor(() => expect(result.current.settings).toEqual(settings));

    // The mutation call itself never resolves within this test, so the only
    // way `settings.view` can already read "grid" is the optimistic merge.
    mockRunPantryQuery.mockReturnValueOnce(new Promise(() => {}));
    act(() => {
      result.current.updateSettings({ view: "grid" });
    });

    expect(result.current.settings?.view).toBe("grid");
  });

  it("reports a save error without reverting the optimistic update", async () => {
    const settings = makeSettings({ view: "list" });
    mockRunPantryQuery.mockResolvedValueOnce({ settings });

    const { result } = renderHook(() => usePantrySettings());
    await waitFor(() => expect(result.current.settings).toEqual(settings));

    mockRunPantryQuery.mockRejectedValueOnce(new Error("save failed"));
    await act(async () => {
      result.current.updateSettings({ view: "grid" });
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.error).toBe("save failed"));
    expect(result.current.settings?.view).toBe("grid");
  });

  it("falls back to a generic save-error message for a non-Error rejection", async () => {
    const settings = makeSettings({ view: "list" });
    mockRunPantryQuery.mockResolvedValueOnce({ settings });

    const { result } = renderHook(() => usePantrySettings());
    await waitFor(() => expect(result.current.settings).toEqual(settings));

    mockRunPantryQuery.mockRejectedValueOnce("boom");
    await act(async () => {
      result.current.updateSettings({ view: "grid" });
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.error).toBe("Failed to save settings"));
  });
});
