import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PantryItemRow from "./PantryItemRow";
import { runPantryQuery } from "../api";
import { StorageLocation, type InventoryItem } from "../api";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();

  return {
    ...actual,
    runPantryQuery: vi.fn(),
  };
});

const mockRunPantryQuery = vi.mocked(runPantryQuery);

function makeItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: "item-1",
    name: "Milk",
    category: null,
    location: StorageLocation.Fridge,
    quantity: 2,
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

const noop = {
  onAddCategory: () => {},
  onChanged: () => Promise.resolve(),
  onError: () => {},
};

describe("PantryItemRow (simple mode)", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("renders only name, unit, stepper, and delete - no meta line or toggles", () => {
    const item = makeItem({ isStaple: true, price: 4 });
    render(
      <ul>
        <PantryItemRow item={item} simple nerdMode={false} categories={[]} {...noop} />
      </ul>
    );

    expect(screen.getByText("Milk")).toBeInTheDocument();
    expect(screen.getByText("L")).toBeInTheDocument();
    expect(screen.getByText("delete")).toBeInTheDocument();
    expect(screen.queryByTitle("Staple - always keep stocked")).not.toBeInTheDocument();
    expect(screen.queryByText("$4.00")).not.toBeInTheDocument();
  });

  it("calls removeInventoryItem when the quantity stepper is dropped to 0", async () => {
    mockRunPantryQuery.mockResolvedValue({ removeInventoryItem: true });

    const item = makeItem({ quantity: 1 });
    render(
      <ul>
        <PantryItemRow item={item} simple nerdMode={false} categories={[]} {...noop} />
      </ul>
    );

    fireEvent.click(screen.getByText("−"));

    await waitFor(() =>
      expect(mockRunPantryQuery).toHaveBeenCalledWith(expect.stringContaining("RemoveInventoryItem"), {
        id: "item-1",
      })
    );
  });
});

describe("PantryItemRow (full mode)", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("shows the low-stock badge only when nearlyEmpty is set", () => {
    const { rerender } = render(
      <ul>
        <PantryItemRow item={makeItem({ nearlyEmpty: false })} simple={false} nerdMode={false} categories={[]} {...noop} />
      </ul>
    );
    expect(screen.queryByText("low stock")).not.toBeInTheDocument();

    rerender(
      <ul>
        <PantryItemRow item={makeItem({ nearlyEmpty: true })} simple={false} nerdMode={false} categories={[]} {...noop} />
      </ul>
    );
    expect(screen.getByText("low stock")).toBeInTheDocument();
  });

  it("shows the price and relative purchased-at date in the meta line", () => {
    render(
      <ul>
        <PantryItemRow
          item={makeItem({ price: 4.5, purchasedAt: new Date().toISOString().slice(0, 10) })}
          simple={false}
          nerdMode={false}
          categories={[]}
          {...noop}
        />
      </ul>
    );

    expect(screen.getByText(/\$4\.50/)).toBeInTheDocument();
    expect(screen.getByText(/today/)).toBeInTheDocument();
  });

  it("colors an expired date distinctly from a soon-to-expire one", () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    render(
      <ul>
        <PantryItemRow item={makeItem({ expiresAt: yesterday })} simple={false} nerdMode={false} categories={[]} {...noop} />
      </ul>
    );

    expect(document.querySelector(".pantry-item-expiry-expired")).toBeInTheDocument();
  });

  it("only renders the last-known-price line when trackPrice is set", () => {
    const { rerender } = render(
      <ul>
        <PantryItemRow item={makeItem({ trackPrice: false })} simple={false} nerdMode={false} categories={[]} {...noop} />
      </ul>
    );
    expect(screen.queryByText("price check pending")).not.toBeInTheDocument();

    rerender(
      <ul>
        <PantryItemRow item={makeItem({ trackPrice: true, lastKnownPrice: null })} simple={false} nerdMode={false} categories={[]} {...noop} />
      </ul>
    );
    expect(screen.getByText("price check pending")).toBeInTheDocument();
  });

  it("toggles the staple flag via saveField and awaits onChanged before re-enabling", async () => {
    mockRunPantryQuery.mockResolvedValue({ updateInventoryItem: makeItem() });

    const onChanged = vi.fn().mockResolvedValue(undefined);
    const item = makeItem({ isStaple: false });
    render(
      <ul>
        <PantryItemRow
          item={item}
          simple={false}
          nerdMode={false}
          categories={[]}
          onAddCategory={() => {}}
          onChanged={onChanged}
          onError={() => {}}
        />
      </ul>
    );

    fireEvent.click(screen.getByTitle("Mark as a staple item"));

    await waitFor(() =>
      expect(mockRunPantryQuery).toHaveBeenCalledWith(
        expect.stringContaining("UpdateInventoryItem"),
        { id: "item-1", input: { isStaple: true } }
      )
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("reports an error via onError when the update mutation fails", async () => {
    mockRunPantryQuery.mockRejectedValue(new Error("network down"));

    const onError = vi.fn();
    render(
      <ul>
        <PantryItemRow
          item={makeItem()}
          simple={false}
          nerdMode={false}
          categories={[]}
          onAddCategory={() => {}}
          onChanged={() => Promise.resolve()}
          onError={onError}
        />
      </ul>
    );

    fireEvent.click(screen.getByTitle("Mark as a staple item"));

    await waitFor(() => expect(onError).toHaveBeenCalledWith("network down"));
  });

  it("shows purchase history toggle only enabled when purchases exist", () => {
    const withHistory = makeItem({ purchases: [{ date: "2026-01-01", price: 3, quantity: 1 }] });
    const { rerender } = render(
      <ul>
        <PantryItemRow item={withHistory} simple={false} nerdMode={false} categories={[]} {...noop} />
      </ul>
    );
    const metaButton = screen.getByTitle("Click for purchase history");
    expect(metaButton).not.toBeDisabled();

    rerender(
      <ul>
        <PantryItemRow item={makeItem({ purchases: [] })} simple={false} nerdMode={false} categories={[]} {...noop} />
      </ul>
    );
    expect(screen.queryByTitle("Click for purchase history")).not.toBeInTheDocument();
  });

  it("expands purchase history (most recent first) when the meta line is clicked", () => {
    const item = makeItem({
      unit: "L",
      purchases: [
        { date: "2026-01-01", price: 3, quantity: 1 },
        { date: "2026-02-01", price: 3.5, quantity: 2 },
      ],
    });
    const { container } = render(
      <ul>
        <PantryItemRow item={item} simple={false} nerdMode={false} categories={[]} {...noop} />
      </ul>
    );

    fireEvent.click(screen.getByTitle("Click for purchase history"));

    const historyItems = container.querySelectorAll(".pantry-purchase-history li");
    expect(historyItems[0]).toHaveTextContent("2026-02-01");
    expect(historyItems[1]).toHaveTextContent("2026-01-01");
  });

  it("commits a renamed, trimmed name on blur, but not when unchanged or empty", () => {
    mockRunPantryQuery.mockResolvedValue({ updateInventoryItem: makeItem() });

    const item = makeItem({ name: "Milk" });
    render(
      <ul>
        <PantryItemRow item={item} simple={false} nerdMode={false} categories={[]} {...noop} />
      </ul>
    );

    fireEvent.click(screen.getByTitle("Click to rename"));

    const input = screen.getByDisplayValue("Milk");
    fireEvent.change(input, { target: { value: "  Oat Milk  " } });
    fireEvent.blur(input);

    expect(mockRunPantryQuery).toHaveBeenCalledWith(expect.stringContaining("UpdateInventoryItem"), {
      id: "item-1",
      input: { name: "Oat Milk" },
    });
  });

  it("does not save a rename when the trimmed name is unchanged", () => {
    const item = makeItem({ name: "Milk" });
    render(
      <ul>
        <PantryItemRow item={item} simple={false} nerdMode={false} categories={[]} {...noop} />
      </ul>
    );

    fireEvent.click(screen.getByTitle("Click to rename"));

    const input = screen.getByDisplayValue("Milk");
    fireEvent.change(input, { target: { value: "  Milk  " } });
    fireEvent.blur(input);

    expect(mockRunPantryQuery).not.toHaveBeenCalled();
  });

  it("shows a Coles link only when trackPrice is set and a link is derivable", () => {
    const item = makeItem({
      trackPrice: true,
      lastKnownPrice: {
        colesPrice: 4.5,
        productUrl: null,
        note: null,
        checkedAt: "2026-01-01T00:00:00.000Z",
        debugInfo: { costUsd: 0, durationMs: 0, searchesUsed: 0, fetchesUsed: 0 },
      },
    });
    render(
      <ul>
        <PantryItemRow item={item} simple={false} nerdMode={false} categories={[]} {...noop} />
      </ul>
    );

    const link = screen.getByText("Search Coles ↗");
    expect(link.closest("a")).toHaveAttribute("href", "https://www.coles.com.au/search?q=Milk");
  });

  it("shows nerd debug info only when nerdMode and trackPrice with a lastKnownPrice are all true", () => {
    const item = makeItem({
      trackPrice: true,
      lastKnownPrice: {
        colesPrice: 4.5,
        productUrl: null,
        note: null,
        checkedAt: "2026-01-01T00:00:00.000Z",
        debugInfo: { costUsd: 0.01, durationMs: 1000, searchesUsed: 0, fetchesUsed: 0 },
      },
    });
    const { rerender } = render(
      <ul>
        <PantryItemRow item={item} simple={false} nerdMode={false} categories={[]} {...noop} />
      </ul>
    );
    expect(screen.queryByText(/\$0\.0100/)).not.toBeInTheDocument();

    rerender(
      <ul>
        <PantryItemRow item={item} simple={false} nerdMode={true} categories={[]} {...noop} />
      </ul>
    );
    expect(screen.getByText(/\$0\.0100/)).toBeInTheDocument();
  });

  it("opens the edit modal from the edit button", () => {
    render(
      <ul>
        <PantryItemRow item={makeItem()} simple={false} nerdMode={false} categories={["Dairy"]} {...noop} />
      </ul>
    );

    fireEvent.click(screen.getByText("edit"));
    expect(screen.getByText("Edit item")).toBeInTheDocument();
  });
});
