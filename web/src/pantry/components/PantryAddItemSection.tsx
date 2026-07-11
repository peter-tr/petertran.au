import { useState, type FormEvent } from "react";
import QuantityStepper from "./QuantityStepper";
import { UNIT_OPTIONS } from "../lib/units";
import { INVENTORY_FLAGS, type InventoryFlags } from "../lib/inventoryFlags";
import {
  runPantryQuery,
  RECORD_PURCHASE_MUTATION,
  type PantrySettings,
  type PantrySettingsInput,
  type RecordPurchaseResult,
  type StorageLocation,
} from "../api";

type Status = "idle" | "saving" | "error";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface PantryAddItemSectionProps {
  settings: PantrySettings;
  onSettingsChange: (partial: PantrySettingsInput) => void;
  onAdded: () => Promise<void>;
}

export default function PantryAddItemSection({
  settings,
  onSettingsChange,
  onAdded,
}: PantryAddItemSectionProps) {
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [category, setCategory] = useState("");
  const [location, setLocation] = useState<StorageLocation>("FRIDGE");
  const [unit, setUnit] = useState("pcs");
  const [price, setPrice] = useState("");
  // Defaults to today so a bare-minimum add (name + quantity only) still
  // records a purchase date, without asking the user for one up front.
  const [purchasedAt, setPurchasedAt] = useState(today());
  const [expiresAt, setExpiresAt] = useState("");
  const [flags, setFlags] = useState<InventoryFlags>({
    isStaple: false,
    lowPriority: false,
    nearlyEmpty: false,
  });
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setError(null);

    try {
      await runPantryQuery<RecordPurchaseResult>(RECORD_PURCHASE_MUTATION, {
        input: {
          name,
          quantity,
          location,
          category: category || null,
          unit: unit || null,
          price: price ? Number(price) : null,
          purchasedAt,
          expiresAt: expiresAt || null,
          ...flags,
        },
      });
      setName("");
      setQuantity(1);
      setCategory("");
      setLocation("FRIDGE");
      setUnit("pcs");
      setPrice("");
      setPurchasedAt(today());
      setExpiresAt("");
      setFlags({ isStaple: false, lowPriority: false, nearlyEmpty: false });
      setStatus("idle");
      // Not awaited - the mutation itself already succeeded (that's what
      // the form reset above is responding to), so there's no reason to
      // keep the form busy/blocked for a second network round trip just to
      // refresh the list in the background. Unlike a toggle button, "add"
      // doesn't read current item state to decide what to send, so there's
      // no stale-data race to guard against by waiting for this.
      onAdded().catch(() => {});
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <div className="pantry-subsection">
      <h3 className="pantry-subsection-title">Add item</h3>

      <form onSubmit={handleSubmit}>
        <div className="pantry-quick-add">
          <input
            className="form-input pantry-quick-add-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Item name"
            required
            maxLength={200}
          />
          <QuantityStepper value={quantity} onChange={setQuantity} min={1} />
          <select
            className="form-input pantry-quick-add-unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            aria-label="Unit"
          >
            {UNIT_OPTIONS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
          <select
            className="form-input pantry-quick-add-location"
            value={location}
            onChange={(e) => setLocation(e.target.value as StorageLocation)}
            aria-label="Location"
          >
            <option value="FRIDGE">Fridge</option>
            <option value="FREEZER">Freezer</option>
            <option value="PANTRY">Pantry</option>
          </select>
          <input
            className="form-input pantry-quick-add-price"
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="$"
            aria-label="Price"
          />
          <button className="run-btn" type="submit" disabled={status === "saving"}>
            {status === "saving" ? "Adding…" : "Add"}
          </button>
        </div>

        <button
          type="button"
          className="pantry-details-toggle"
          onClick={() => onSettingsChange({ addItemDetailsShown: !settings.addItemDetailsShown })}
        >
          {settings.addItemDetailsShown ? "− fewer details" : "+ more details"}
        </button>

        {settings.addItemDetailsShown && (
          <div className="pantry-details-grid">
            <div className="form-row">
              <label className="form-label" htmlFor="pantry-category">
                Category
              </label>
              <input
                id="pantry-category"
                className="form-input"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Dairy, Produce, Frozen..."
                maxLength={100}
              />
            </div>

            <div className="form-row">
              <label className="form-label" htmlFor="pantry-purchased">
                Purchased on
              </label>
              <input
                id="pantry-purchased"
                className="form-input"
                type="date"
                value={purchasedAt}
                onChange={(e) => setPurchasedAt(e.target.value)}
              />
            </div>

            <div className="form-row">
              <label className="form-label" htmlFor="pantry-expires">
                Expires on
              </label>
              <input
                id="pantry-expires"
                className="form-input"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>

            <div className="form-row pantry-staple-row pantry-flags-row">
              {INVENTORY_FLAGS.map(({ key, icon, label }) => (
                <label className="form-label" htmlFor={`pantry-add-${key}`} key={key}>
                  <input
                    id={`pantry-add-${key}`}
                    type="checkbox"
                    checked={flags[key]}
                    onChange={(e) => setFlags({ ...flags, [key]: e.target.checked })}
                  />{" "}
                  {icon} {label}
                </label>
              ))}
            </div>
          </div>
        )}

        {error && <p className="status-line">// {error}</p>}
      </form>
    </div>
  );
}
