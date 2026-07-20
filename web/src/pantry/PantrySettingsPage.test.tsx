import { act, render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PantrySettingsPage from "./PantrySettingsPage";
import { runPantryQuery } from "./api";
import type { PantrySettings, PriceSyncStatus } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();

  return {
    ...actual,
    runPantryQuery: vi.fn(),
  };
});

vi.mock("./components/PantryArchitectureDiagram", () => ({
  default: () => <div data-testid="architecture-diagram" />,
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

function makeSyncStatus(overrides: Partial<PriceSyncStatus> = {}): PriceSyncStatus {
  return {
    running: false,
    startedAt: null,
    finishedAt: null,
    totalItems: 0,
    checkedItems: 0,
    errors: [],
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <PantrySettingsPage />
    </MemoryRouter>
  );
}

describe("PantrySettingsPage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it("loads settings and the price-sync status on mount", async () => {
    mockRunPantryQuery
      .mockResolvedValueOnce({ settings: makeSettings({ digestEnabled: true, digestHour: 9 }) })
      .mockResolvedValueOnce({ priceSyncStatus: makeSyncStatus() });

    renderPage();

    await waitFor(() => expect(screen.getByLabelText(/Send the daily digest email/)).toBeChecked());
    expect(screen.getByLabelText("Send time (Australia/Sydney)")).toHaveValue("9");
  });

  it("formats the digest hour options in 12-hour am/pm form", async () => {
    mockRunPantryQuery
      .mockResolvedValueOnce({ settings: makeSettings() })
      .mockResolvedValueOnce({ priceSyncStatus: makeSyncStatus() });

    renderPage();

    await waitFor(() => screen.getByLabelText("Send time (Australia/Sydney)"));
    expect(screen.getByRole("option", { name: "12:00am" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "1:00pm" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "11:00pm" })).toBeInTheDocument();
  });

  it("disables the digest-hour select when the digest is off", async () => {
    mockRunPantryQuery
      .mockResolvedValueOnce({ settings: makeSettings({ digestEnabled: false }) })
      .mockResolvedValueOnce({ priceSyncStatus: makeSyncStatus() });

    renderPage();

    await waitFor(() => expect(screen.getByLabelText("Send time (Australia/Sydney)")).toBeDisabled());
  });

  it("shows an error banner when settings fail to load", async () => {
    mockRunPantryQuery
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ priceSyncStatus: makeSyncStatus() });

    renderPage();

    expect(await screen.findByText(/couldn't load settings right now \(offline\)/)).toBeInTheDocument();
  });

  it("shows the last-synced summary, including a failure count, when not currently syncing", async () => {
    mockRunPantryQuery.mockResolvedValueOnce({ settings: makeSettings() }).mockResolvedValueOnce({
      priceSyncStatus: makeSyncStatus({
        finishedAt: "2026-07-01T00:00:00.000Z",
        totalItems: 5,
        checkedItems: 5,
        errors: [{ itemName: "Milk", message: "no match", occurredAt: "2026-07-01T00:00:00.000Z" }],
      }),
    });

    renderPage();

    expect(await screen.findByText(/last synced 5 of 5 items \(1 failed\)/)).toBeInTheDocument();
    expect(screen.getByText("Milk")).toBeInTheDocument();
  });

  it("uses singular 'item' when totalItems is 1", async () => {
    mockRunPantryQuery.mockResolvedValueOnce({ settings: makeSettings() }).mockResolvedValueOnce({
      priceSyncStatus: makeSyncStatus({ finishedAt: "2026-07-01T00:00:00.000Z", totalItems: 1, checkedItems: 1 }),
    });

    renderPage();

    expect(await screen.findByText(/last synced 1 of 1 item(?!s)/)).toBeInTheDocument();
  });

  it("shows a running progress line with an estimate while syncing", async () => {
    mockRunPantryQuery.mockResolvedValueOnce({ settings: makeSettings() }).mockResolvedValueOnce({
      priceSyncStatus: makeSyncStatus({ running: true, totalItems: 10, checkedItems: 2 }),
    });

    const { container } = renderPage();

    // (10 - 2) * 8s = 64s -> rounds to ~1m
    expect(await screen.findByText(/checking 2 of 10 - ~1m remaining/)).toBeInTheDocument();
    expect(container.querySelector(".pantry-edit-btn")).toBeDisabled();
  });

  it("triggers a sync and starts polling on 'Sync prices now'", async () => {
    mockRunPantryQuery
      .mockResolvedValueOnce({ settings: makeSettings() })
      .mockResolvedValueOnce({ priceSyncStatus: makeSyncStatus() })
      .mockResolvedValueOnce({ syncPricesNow: true })
      .mockResolvedValueOnce({ priceSyncStatus: makeSyncStatus({ running: true, totalItems: 3, checkedItems: 0 }) });

    renderPage();
    await screen.findByText("Sync prices now");

    await act(async () => {
      fireEvent.click(screen.getByText("Sync prices now"));
      await Promise.resolve();
    });

    expect(await screen.findByText(/checking 0 of 3/)).toBeInTheDocument();

    // Polling picks up completion after the interval fires.
    mockRunPantryQuery.mockResolvedValueOnce({
      priceSyncStatus: makeSyncStatus({ running: false, totalItems: 3, checkedItems: 3, finishedAt: "2026-07-01T00:00:00.000Z" }),
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(await screen.findByText(/last synced 3 of 3 items/)).toBeInTheDocument();
  });

  it("shows a trigger error when 'Sync prices now' itself fails to start", async () => {
    mockRunPantryQuery
      .mockResolvedValueOnce({ settings: makeSettings() })
      .mockResolvedValueOnce({ priceSyncStatus: makeSyncStatus() })
      .mockRejectedValueOnce(new Error("boom"));

    renderPage();
    await screen.findByText("Sync prices now");

    await act(async () => {
      fireEvent.click(screen.getByText("Sync prices now"));
      await Promise.resolve();
    });

    expect(await screen.findByText("// Couldn't start the sync.")).toBeInTheDocument();
  });

  it("renders the architecture diagram", async () => {
    mockRunPantryQuery
      .mockResolvedValueOnce({ settings: makeSettings() })
      .mockResolvedValueOnce({ priceSyncStatus: makeSyncStatus() });

    renderPage();

    expect(screen.getByTestId("architecture-diagram")).toBeInTheDocument();
  });
});
