import { useState } from "react";
import QuantityStepper from "./QuantityStepper";
import PantryInlineAddToggle from "./PantryInlineAddToggle";
import { UNIT_OPTIONS } from "../lib/units";
import { runPantryQuery, RECORD_PURCHASE_MUTATION, type RecordPurchaseResult } from "../api";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface PantryCommonItemsSectionProps {
  commonItems: string[];
  onCommonItemsChange: (next: string[]) => void;
  onAdded: () => Promise<void>;
}

export default function PantryCommonItemsSection({
  commonItems,
  onCommonItemsChange,
  onAdded,
}: PantryCommonItemsSectionProps) {
  const [openName, setOpenName] = useState<string | null>(null);
  const [pickerQty, setPickerQty] = useState(1);
  const [pickerUnit, setPickerUnit] = useState("pcs");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleOpen(name: string) {
    if (openName === name) {
      setOpenName(null);
    } else {
      setOpenName(name);
      setPickerQty(1);
      setPickerUnit("pcs");
    }
  }

  function deleteCommonItem(name: string) {
    onCommonItemsChange(commonItems.filter((n) => n !== name));
    if (openName === name) setOpenName(null);
  }

  function handleAddCommonItem(name: string) {
    if (commonItems.includes(name)) return;
    onCommonItemsChange([...commonItems, name]);
  }

  async function confirmAdd(name: string) {
    setBusy(true);
    setError(null);
    try {
      await runPantryQuery<RecordPurchaseResult>(RECORD_PURCHASE_MUTATION, {
        input: {
          name,
          quantity: pickerQty,
          location: "FRIDGE",
          unit: pickerUnit,
          purchasedAt: today(),
        },
      });
      setOpenName(null);
      // Not awaited - see PantryAddItemSection for why this is safe for an
      // "add" (not a toggle): closing the picker immediately after the
      // mutation succeeds instead of after a second refetch round trip.
      onAdded().catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add item.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pantry-panel">
      <h2 className="pantry-panel-title">Common items</h2>
      <div className="pantry-common-items">
        {commonItems.map((name) => (
          <div key={name} className="pantry-common-item">
            <button type="button" className="pantry-common-item-btn" onClick={() => toggleOpen(name)}>
              {name}
              <span
                className="pantry-common-item-delete"
                role="button"
                aria-label={`Remove ${name} from common items`}
                onClick={(e) => {
                  e.stopPropagation();
                  deleteCommonItem(name);
                }}
              >
                ×
              </span>
            </button>

            {openName === name && (
              <div className="pantry-common-item-picker">
                <QuantityStepper value={pickerQty} onChange={setPickerQty} min={1} disabled={busy} />
                <select
                  className="form-input pantry-common-item-unit"
                  value={pickerUnit}
                  onChange={(e) => setPickerUnit(e.target.value)}
                  disabled={busy}
                  aria-label="Unit"
                >
                  {UNIT_OPTIONS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
                <button type="button" className="run-btn" onClick={() => confirmAdd(name)} disabled={busy}>
                  Add
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <PantryInlineAddToggle
        placeholder="Add a common item..."
        toggleLabel="+ add common item"
        onAdd={handleAddCommonItem}
      />

      {error && <p className="status-line">// {error}</p>}
    </section>
  );
}
