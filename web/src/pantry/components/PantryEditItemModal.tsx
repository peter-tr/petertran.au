import { useState } from "react";
import QuantityStepper from "./QuantityStepper";
import { UNIT_OPTIONS, stepForUnit } from "../lib/units";
import type { InventoryItem, StorageLocation } from "../api";

interface PantryEditItemModalProps {
  item: InventoryItem;
  busy: boolean;
  categories: string[];
  onAddCategory: (name: string) => void;
  onClose: () => void;
  onSave: (input: Record<string, unknown>) => Promise<void>;
}

const LOCATION_OPTIONS: { value: StorageLocation; label: string }[] = [
  { value: "FRIDGE", label: "Fridge" },
  { value: "FREEZER", label: "Freezer" },
  { value: "PANTRY", label: "Pantry" },
];

const ADD_CATEGORY_VALUE = "__add_new__";

export default function PantryEditItemModal({
  item,
  busy,
  categories,
  onAddCategory,
  onClose,
  onSave,
}: PantryEditItemModalProps) {
  const [name, setName] = useState(item.name);
  const [quantity, setQuantity] = useState(item.quantity);
  const [unit, setUnit] = useState(item.unit ?? "");
  const [location, setLocation] = useState<StorageLocation>(item.location);
  const [category, setCategory] = useState(item.category ?? "");
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [price, setPrice] = useState(item.price !== null ? String(item.price) : "");
  const [purchasedAt, setPurchasedAt] = useState(item.purchasedAt ?? "");
  const [expiresAt, setExpiresAt] = useState(item.expiresAt ?? "");
  const [isStaple, setIsStaple] = useState(item.isStaple);
  const [lowPriority, setLowPriority] = useState(item.lowPriority);
  const [nearlyEmpty, setNearlyEmpty] = useState(item.nearlyEmpty);
  const [error, setError] = useState<string | null>(null);

  // A category already on this item might not be one of the curated options
  // (e.g. set by the AI, or from before it was added to the list here) -
  // include it so saving without touching this field doesn't silently drop it.
  const categoryOptions = category && !categories.includes(category) ? [category, ...categories] : categories;

  function commitNewCategory() {
    const trimmed = newCategory.trim();
    if (trimmed) {
      onAddCategory(trimmed);
      setCategory(trimmed);
    }
    setNewCategory("");
    setAddingCategory(false);
  }

  // A unit already on this item might not be one of the fixed dropdown
  // options (e.g. set directly through the API) - include it so saving
  // without touching this field doesn't silently drop it.
  const unitOptions = unit && !UNIT_OPTIONS.includes(unit) ? [unit, ...UNIT_OPTIONS] : UNIT_OPTIONS;

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
        quantity,
        unit: unit || null,
        location,
        category: category.trim() || null,
        price: price.trim() ? Number(price) : null,
        purchasedAt: purchasedAt || null,
        expiresAt: expiresAt || null,
        isStaple,
        lowPriority,
        nearlyEmpty,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    }
  }

  return (
    <div className="pantry-modal-backdrop" onClick={onClose}>
      <div className="pantry-modal" onClick={(e) => e.stopPropagation()}>
        <p className="pantry-modal-title">Edit item</p>

        <div className="form-row">
          <label className="form-label" htmlFor="pantry-edit-name">
            Name
          </label>
          <input
            id="pantry-edit-name"
            className="form-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            disabled={busy}
          />
        </div>

        <div className="pantry-edit-grid">
          <div className="form-row">
            <label className="form-label">Quantity</label>
            <QuantityStepper
              value={quantity}
              onChange={setQuantity}
              min={0}
              step={stepForUnit(unit || null)}
              disabled={busy}
            />
          </div>
          <div className="form-row">
            <label className="form-label" htmlFor="pantry-edit-unit">
              Unit
            </label>
            <select
              id="pantry-edit-unit"
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
            <label className="form-label" htmlFor="pantry-edit-location">
              Location
            </label>
            <select
              id="pantry-edit-location"
              className="form-input"
              value={location}
              onChange={(e) => setLocation(e.target.value as StorageLocation)}
              disabled={busy}
            >
              {LOCATION_OPTIONS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label className="form-label" htmlFor="pantry-edit-category">
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
                id="pantry-edit-category"
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
            <label className="form-label" htmlFor="pantry-edit-price">
              Price
            </label>
            <input
              id="pantry-edit-price"
              className="form-input"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="$"
              disabled={busy}
            />
          </div>
          <div className="form-row">
            <label className="form-label" htmlFor="pantry-edit-purchased">
              Purchased on
            </label>
            <input
              id="pantry-edit-purchased"
              className="form-input"
              type="date"
              value={purchasedAt}
              onChange={(e) => setPurchasedAt(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="form-row">
            <label className="form-label" htmlFor="pantry-edit-expires">
              Expires on
            </label>
            <input
              id="pantry-edit-expires"
              className="form-input"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="form-row pantry-staple-row pantry-flags-row">
            <label className="form-label" htmlFor="pantry-edit-staple">
              <input
                id="pantry-edit-staple"
                type="checkbox"
                checked={isStaple}
                onChange={(e) => setIsStaple(e.target.checked)}
                disabled={busy}
              />{" "}
              ★ Staple - always keep stocked
            </label>
            <label className="form-label" htmlFor="pantry-edit-low-priority">
              <input
                id="pantry-edit-low-priority"
                type="checkbox"
                checked={lowPriority}
                onChange={(e) => setLowPriority(e.target.checked)}
                disabled={busy}
              />{" "}
              ↓ Low priority - hide from main list
            </label>
            <label className="form-label" htmlFor="pantry-edit-nearly-empty">
              <input
                id="pantry-edit-nearly-empty"
                type="checkbox"
                checked={nearlyEmpty}
                onChange={(e) => setNearlyEmpty(e.target.checked)}
                disabled={busy}
              />{" "}
              ! Nearly empty
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
