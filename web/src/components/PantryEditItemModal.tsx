import { useState } from "react";
import QuantityStepper from "./QuantityStepper";
import { UNIT_OPTIONS } from "../lib/units";
import type { InventoryItem, StorageLocation } from "../lib/pantryGraphql";

interface PantryEditItemModalProps {
  item: InventoryItem;
  busy: boolean;
  onClose: () => void;
  onSave: (input: Record<string, unknown>) => Promise<void>;
}

const LOCATION_OPTIONS: { value: StorageLocation; label: string }[] = [
  { value: "FRIDGE", label: "Fridge" },
  { value: "FREEZER", label: "Freezer" },
  { value: "PANTRY", label: "Pantry" },
];

export default function PantryEditItemModal({ item, busy, onClose, onSave }: PantryEditItemModalProps) {
  const [name, setName] = useState(item.name);
  const [quantity, setQuantity] = useState(item.quantity);
  const [unit, setUnit] = useState(item.unit ?? "");
  const [location, setLocation] = useState<StorageLocation>(item.location);
  const [category, setCategory] = useState(item.category ?? "");
  const [price, setPrice] = useState(item.price !== null ? String(item.price) : "");
  const [purchasedAt, setPurchasedAt] = useState(item.purchasedAt ?? "");
  const [expiresAt, setExpiresAt] = useState(item.expiresAt ?? "");
  const [isStaple, setIsStaple] = useState(item.isStaple);
  const [error, setError] = useState<string | null>(null);

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
            autoFocus
          />
        </div>

        <div className="pantry-edit-grid">
          <div className="form-row">
            <label className="form-label">Quantity</label>
            <QuantityStepper value={quantity} onChange={setQuantity} min={0} disabled={busy} />
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
            <input
              id="pantry-edit-category"
              className="form-input"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Dairy, Produce..."
              maxLength={100}
              disabled={busy}
            />
          </div>
          <div className="form-row">
            <label className="form-label" htmlFor="pantry-edit-price">
              Price
            </label>
            <input
              id="pantry-edit-price"
              className="form-input"
              type="number"
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
          <div className="form-row pantry-staple-row">
            <label className="form-label" htmlFor="pantry-edit-staple">
              <input
                id="pantry-edit-staple"
                type="checkbox"
                checked={isStaple}
                onChange={(e) => setIsStaple(e.target.checked)}
                disabled={busy}
              />{" "}
              Staple - always keep stocked
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
