import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PantryEditItemModal from "./PantryEditItemModal";
import { StorageLocation, type InventoryItem } from "../api";

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

describe("PantryEditItemModal", () => {
  it("pre-fills the form fields from the given item", () => {
    render(
      <PantryEditItemModal
        item={makeItem({ name: "Milk", quantity: 2, unit: "L", price: 4.5 })}
        busy={false}
        categories={[]}
        onAddCategory={() => {}}
        onClose={() => {}}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByLabelText("Name")).toHaveValue("Milk");
    expect(screen.getByLabelText("Price")).toHaveValue(4.5);
  });

  it("shows an error and does not call onSave when the name is blank", async () => {
    const onSave = vi.fn();
    render(
      <PantryEditItemModal
        item={makeItem()}
        busy={false}
        categories={[]}
        onAddCategory={() => {}}
        onClose={() => {}}
        onSave={onSave}
      />
    );

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "   " } });
    fireEvent.click(screen.getByText("Save"));

    expect(await screen.findByText("// Name can't be empty.")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves trimmed name, flags, and null-coerced optional fields, then closes", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <PantryEditItemModal
        item={makeItem({ name: "Milk", category: null, price: null })}
        busy={false}
        categories={["Dairy"]}
        onAddCategory={() => {}}
        onClose={onClose}
        onSave={onSave}
      />
    );

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  Oat Milk  " } });
    fireEvent.click(screen.getByText("Save"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Oat Milk",
        unit: "L",
        category: null,
        price: null,
        purchasedAt: null,
        expiresAt: null,
        isStaple: false,
        lowPriority: false,
        nearlyEmpty: false,
        trackPrice: false,
      })
    );
    await screen.findByText("Save"); // still rendered synchronously; assert close happened after resolve
    expect(onClose).toHaveBeenCalled();
  });

  it("parses a typed price into a number", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <PantryEditItemModal
        item={makeItem({ price: null })}
        busy={false}
        categories={[]}
        onAddCategory={() => {}}
        onClose={() => {}}
        onSave={onSave}
      />
    );

    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "9.99" } });
    fireEvent.click(screen.getByText("Save"));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ price: 9.99 }));
  });

  it("shows an error message when onSave rejects", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("save failed"));
    render(
      <PantryEditItemModal
        item={makeItem()}
        busy={false}
        categories={[]}
        onAddCategory={() => {}}
        onClose={() => {}}
        onSave={onSave}
      />
    );

    fireEvent.click(screen.getByText("Save"));

    expect(await screen.findByText("// save failed")).toBeInTheDocument();
  });

  it("includes the item's current unit as a select option even if not in UNIT_OPTIONS", () => {
    render(
      <PantryEditItemModal
        item={makeItem({ unit: "jar" })}
        busy={false}
        categories={[]}
        onAddCategory={() => {}}
        onClose={() => {}}
        onSave={vi.fn()}
      />
    );

    expect(screen.getByRole("option", { name: "jar" })).toBeInTheDocument();
  });

  it("includes the item's current category as a select option even if not in the curated list", () => {
    render(
      <PantryEditItemModal
        item={makeItem({ category: "Weird Category" })}
        busy={false}
        categories={["Dairy", "Produce"]}
        onAddCategory={() => {}}
        onClose={() => {}}
        onSave={vi.fn()}
      />
    );

    expect(screen.getByRole("option", { name: "Weird Category" })).toBeInTheDocument();
  });

  it("does not duplicate a category that's already in the curated list", () => {
    render(
      <PantryEditItemModal
        item={makeItem({ category: "Dairy" })}
        busy={false}
        categories={["Dairy", "Produce"]}
        onAddCategory={() => {}}
        onClose={() => {}}
        onSave={vi.fn()}
      />
    );

    expect(screen.getAllByRole("option", { name: "Dairy" })).toHaveLength(1);
  });

  it("switches to a text input for adding a new category and commits it on blur", () => {
    const onAddCategory = vi.fn();
    render(
      <PantryEditItemModal
        item={makeItem()}
        busy={false}
        categories={["Dairy"]}
        onAddCategory={onAddCategory}
        onClose={() => {}}
        onSave={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "__add_new__" } });

    const newCategoryInput = screen.getByPlaceholderText("New category name");
    fireEvent.change(newCategoryInput, { target: { value: "Snacks" } });
    fireEvent.blur(newCategoryInput);

    expect(onAddCategory).toHaveBeenCalledWith("Snacks");
    expect(screen.getByLabelText("Category")).toHaveValue("Snacks");
  });

  it("discards the new-category input when Escape is pressed", () => {
    const onAddCategory = vi.fn();
    render(
      <PantryEditItemModal
        item={makeItem()}
        busy={false}
        categories={["Dairy"]}
        onAddCategory={onAddCategory}
        onClose={() => {}}
        onSave={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "__add_new__" } });

    const newCategoryInput = screen.getByPlaceholderText("New category name");
    fireEvent.change(newCategoryInput, { target: { value: "Snacks" } });
    fireEvent.keyDown(newCategoryInput, { key: "Escape" });

    expect(onAddCategory).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Category")).toBeInTheDocument();
  });

  it("toggles a flag checkbox", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <PantryEditItemModal
        item={makeItem({ isStaple: false })}
        busy={false}
        categories={[]}
        onAddCategory={() => {}}
        onClose={() => {}}
        onSave={onSave}
      />
    );

    fireEvent.click(screen.getByLabelText(/Staple - always keep stocked/));
    fireEvent.click(screen.getByText("Save"));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ isStaple: true }));
  });

  it("disables inputs and shows Saving… label while busy", () => {
    render(
      <PantryEditItemModal
        item={makeItem()}
        busy={true}
        categories={[]}
        onAddCategory={() => {}}
        onClose={() => {}}
        onSave={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByText("Saving…")).toBeInTheDocument();
  });

  it("calls onClose when Cancel is clicked, without calling onSave", () => {
    const onClose = vi.fn();
    const onSave = vi.fn();
    render(
      <PantryEditItemModal
        item={makeItem()}
        busy={false}
        categories={[]}
        onAddCategory={() => {}}
        onClose={onClose}
        onSave={onSave}
      />
    );

    fireEvent.click(screen.getByText("Cancel"));

    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
