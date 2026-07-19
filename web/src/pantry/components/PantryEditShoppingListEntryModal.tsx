import { useState } from "react";
import { UNIT_OPTIONS } from "../lib/units";
import type { ShoppingListEntry } from "../api";

interface PantryEditShoppingListEntryModalProps {
  entry: ShoppingListEntry;
  busy: boolean;
  categories: string[];
  onAddCategory: (name: string) => void;
  onClose: () => void;
  onSave: (input: Record<string, unknown>) => Promise<void>;
}

const ADD_CATEGORY_VALUE = "__add_new__";

export default function PantryEditShoppingListEntryModal({
  entry,
  busy,
  categories,
  onAddCategory,
  onClose,
  onSave,
}: PantryEditShoppingListEntryModalProps) {
  const [name, setName] = useState(entry.name);
  const [quantity, setQuantity] = useState(entry.quantity != null ? String(entry.quantity) : "");
  const [unit, setUnit] = useState(entry.unit ?? "");
  const [note, setNote] = useState(entry.note ?? "");
  const [category, setCategory] = useState(entry.category ?? "");
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [recipeTag, setRecipeTag] = useState(entry.recipeTag ?? "");
  const [urgent, setUrgent] = useState(entry.urgent);
  const [trackPrice, setTrackPrice] = useState(entry.trackPrice);
  const [error, setError] = useState<string | null>(null);

  // Same reasoning as PantryEditItemModal - a category/unit already on this
  // entry might not be one of the curated options, so include it rather
  // than silently dropping it on save.
  const categoryOptions = category && !categories.includes(category) ? [category, ...categories] : categories;
  const unitOptions = unit && !UNIT_OPTIONS.includes(unit) ? [unit, ...UNIT_OPTIONS] : UNIT_OPTIONS;

  function commitNewCategory() {
    const trimmed = newCategory.trim();
    if (trimmed) {
      onAddCategory(trimmed);
      setCategory(trimmed);
    }
    setNewCategory("");
    setAddingCategory(false);
  }

  async function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Name can't be empty.");

      return;
    }
    setError(null);
    try {
      await onSave({
        name: trimmedName,
        quantity: quantity.trim() ? Number(quantity) : null,
        unit: unit || null,
        note: note.trim() || null,
        category: category.trim() || null,
        recipeTag: recipeTag.trim() || null,
        urgent,
        trackPrice,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    }
  }

  return (
    <div className="pantry-modal-backdrop" onClick={onClose}>
      <div className="pantry-modal" onClick={(e) => e.stopPropagation()}>
        <p className="pantry-modal-title">Edit shopping list entry</p>

        <div className="form-row">
          <label className="form-label" htmlFor="pantry-shopping-edit-name">
            Name
          </label>
          <input
            id="pantry-shopping-edit-name"
            className="form-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            disabled={busy}
          />
        </div>

        <div className="pantry-edit-grid">
          <div className="form-row">
            <label className="form-label" htmlFor="pantry-shopping-edit-quantity">
              Quantity
            </label>
            <input
              id="pantry-shopping-edit-quantity"
              className="form-input"
              type="number"
              inputMode="decimal"
              min="0"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="No quantity set"
              disabled={busy}
            />
          </div>
          <div className="form-row">
            <label className="form-label" htmlFor="pantry-shopping-edit-unit">
              Unit
            </label>
            <select
              id="pantry-shopping-edit-unit"
              className="form-input"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              disabled={busy}
            >
              <option value="">No unit</option>
              {unitOptions.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label className="form-label" htmlFor="pantry-shopping-edit-category">
              Category
            </label>
            {addingCategory ? (
              <input
                className="form-input"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="New category name"
                maxLength={100}
                disabled={busy}
                autoFocus
                onBlur={commitNewCategory}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitNewCategory();
                  if (e.key === "Escape") {
                    setNewCategory("");
                    setAddingCategory(false);
                  }
                }}
              />
            ) : (
              <select
                id="pantry-shopping-edit-category"
                className="form-input"
                value={category}
                onChange={(e) => {
                  if (e.target.value === ADD_CATEGORY_VALUE) setAddingCategory(true);
                  else setCategory(e.target.value);
                }}
                disabled={busy}
              >
                <option value="">No category</option>
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value={ADD_CATEGORY_VALUE}>+ Add new category…</option>
              </select>
            )}
          </div>
          <div className="form-row">
            <label className="form-label" htmlFor="pantry-shopping-edit-recipe-tag">
              Recipe
            </label>
            <input
              id="pantry-shopping-edit-recipe-tag"
              className="form-input"
              value={recipeTag}
              onChange={(e) => setRecipeTag(e.target.value)}
              placeholder="Not tied to a recipe"
              maxLength={200}
              disabled={busy}
            />
          </div>
          <div className="form-row">
            <label className="form-label" htmlFor="pantry-shopping-edit-note">
              Note
            </label>
            <input
              id="pantry-shopping-edit-note"
              className="form-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="No note"
              maxLength={200}
              disabled={busy}
            />
          </div>
          <div className="form-row pantry-staple-row pantry-flags-row">
            <label className="form-label" htmlFor="pantry-shopping-edit-urgent">
              <input
                id="pantry-shopping-edit-urgent"
                type="checkbox"
                checked={urgent}
                onChange={(e) => setUrgent(e.target.checked)}
                disabled={busy}
              />{" "}
              ! Urgent
            </label>
            <label className="form-label" htmlFor="pantry-shopping-edit-track-price">
              <input
                id="pantry-shopping-edit-track-price"
                type="checkbox"
                checked={trackPrice}
                onChange={(e) => setTrackPrice(e.target.checked)}
                disabled={busy}
              />{" "}
              $ Track price
            </label>
          </div>
        </div>

        {error && <p className="status-line">// {error}</p>}

        <div className="pantry-modal-actions">
          <button type="button" className="pantry-details-toggle" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="run-btn" onClick={handleSave} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
