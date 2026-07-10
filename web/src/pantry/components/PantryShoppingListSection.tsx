import { useState } from "react";
import PantryInlineAddToggle from "./PantryInlineAddToggle";
import { UNIT_OPTIONS } from "../lib/units";
import {
  runPantryQuery,
  ADD_TO_SHOPPING_LIST_MUTATION,
  RECORD_PURCHASE_MUTATION,
  REMOVE_FROM_SHOPPING_LIST_MUTATION,
  UPDATE_SHOPPING_LIST_ENTRY_MUTATION,
  type AddToShoppingListResult,
  type InventoryItem,
  type PantrySettings,
  type PantrySettingsInput,
  type RecordPurchaseResult,
  type RemoveFromShoppingListResult,
  type ShoppingListEntry,
  type UpdateShoppingListEntryResult,
} from "../api";

interface EditDraft {
  name: string;
  quantity: string;
  unit: string;
  note: string;
}

interface PantryShoppingListSectionProps {
  entries: ShoppingListEntry[];
  items: InventoryItem[];
  settings: PantrySettings;
  onSettingsChange: (input: PantrySettingsInput) => void;
  onChanged: () => Promise<void>;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function PantryShoppingListSection({
  entries,
  items,
  settings,
  onSettingsChange,
  onChanged,
}: PantryShoppingListSectionProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);

  function startEdit(entry: ShoppingListEntry) {
    setEditingId(entry.id);
    setDraft({
      name: entry.name,
      quantity: entry.quantity != null ? String(entry.quantity) : "",
      unit: entry.unit ?? "",
      note: entry.note ?? "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
  }

  async function saveEdit(id: string) {
    if (!draft) return;
    const trimmedName = draft.name.trim();
    if (!trimmedName) {
      setError("Name can't be empty.");
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      await runPantryQuery<UpdateShoppingListEntryResult>(UPDATE_SHOPPING_LIST_ENTRY_MUTATION, {
        id,
        input: {
          name: trimmedName,
          quantity: draft.quantity.trim() ? Number(draft.quantity) : null,
          unit: draft.unit || null,
          note: draft.note.trim() || null,
        },
      });
      cancelEdit();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update shopping list entry.");
    } finally {
      setBusyId(null);
    }
  }

  // "Bought" means it's now actually in stock - record it as a purchase (so
  // it shows up in inventory), then drop it off the shopping list. Reuses
  // an existing inventory item's location if the name matches one, so this
  // merges instead of creating a stray duplicate in the wrong place.
  async function handleBought(entry: ShoppingListEntry) {
    setBusyId(entry.id);
    setError(null);
    try {
      const needle = entry.name.trim().toLowerCase();
      const matchingItem = items.find((i) => i.name.trim().toLowerCase() === needle);
      await runPantryQuery<RecordPurchaseResult>(RECORD_PURCHASE_MUTATION, {
        input: {
          name: entry.name,
          location: matchingItem?.location ?? "PANTRY",
          quantity: entry.quantity ?? 1,
          unit: entry.unit,
          purchasedAt: today(),
          // Carries the staple flag through the remove -> shopping list ->
          // re-buy cycle instead of it silently resetting to false.
          isStaple: entry.isStaple || matchingItem?.isStaple || false,
        },
      });
      await runPantryQuery<RemoveFromShoppingListResult>(REMOVE_FROM_SHOPPING_LIST_MUTATION, {
        id: entry.id,
      });
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record purchase.");
    } finally {
      setBusyId(null);
    }
  }

  // For "didn't end up buying this" - removes the entry without touching
  // inventory at all.
  async function handleRemove(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await runPantryQuery<RemoveFromShoppingListResult>(REMOVE_FROM_SHOPPING_LIST_MUTATION, { id });
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update shopping list.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleAdd(name: string) {
    setError(null);
    try {
      await runPantryQuery<AddToShoppingListResult>(ADD_TO_SHOPPING_LIST_MUTATION, { name });
      // Not awaited - see PantryAddItemSection for why "add" flows don't
      // need to block on the follow-up refetch the way toggles do.
      onChanged().catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add to shopping list.");
    }
  }

  return (
    <section className="pantry-panel">
      <div className="pantry-panel-header">
        <h2 className="pantry-panel-title">Shopping list</h2>
        <button
          type="button"
          className="pantry-details-toggle"
          onClick={() => onSettingsChange({ shoppingListCollapsed: !settings.shoppingListCollapsed })}
        >
          {settings.shoppingListCollapsed ? "+ show" : "− hide"}
        </button>
      </div>

      {error && <p className="status-line">// {error}</p>}

      {!settings.shoppingListCollapsed && (
        <>
          {entries.length > 0 && (
            <ul className="pantry-shopping-list">
              {entries.map((entry) =>
                editingId === entry.id && draft ? (
                  <li key={entry.id} className="pantry-shopping-item pantry-shopping-item-editing">
                    <div className="pantry-shopping-edit-row">
                      <input
                        className="form-input"
                        value={draft.name}
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                        maxLength={200}
                        disabled={busyId === entry.id}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit(entry.id);
                          if (e.key === "Escape") cancelEdit();
                        }}
                      />
                      <input
                        className="form-input pantry-shopping-edit-qty"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        value={draft.quantity}
                        onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
                        placeholder="Qty"
                        disabled={busyId === entry.id}
                      />
                      <select
                        className="form-input pantry-shopping-edit-unit"
                        value={draft.unit}
                        onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
                        disabled={busyId === entry.id}
                      >
                        <option value="">No unit</option>
                        {(draft.unit && !UNIT_OPTIONS.includes(draft.unit)
                          ? [draft.unit, ...UNIT_OPTIONS]
                          : UNIT_OPTIONS
                        ).map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                      <input
                        className="form-input"
                        value={draft.note}
                        onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                        placeholder="Note"
                        maxLength={200}
                        disabled={busyId === entry.id}
                      />
                    </div>
                    <span className="pantry-shopping-item-actions">
                      <button
                        type="button"
                        className="run-btn"
                        onClick={() => saveEdit(entry.id)}
                        disabled={busyId === entry.id}
                      >
                        {busyId === entry.id ? "…" : "save"}
                      </button>
                      <button
                        type="button"
                        className="pantry-details-toggle"
                        onClick={cancelEdit}
                        disabled={busyId === entry.id}
                      >
                        cancel
                      </button>
                    </span>
                  </li>
                ) : (
                  <li key={entry.id} className="pantry-shopping-item">
                    <span
                      className="pantry-shopping-item-name"
                      role="button"
                      tabIndex={0}
                      title="Click to edit"
                      onClick={() => startEdit(entry)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          startEdit(entry);
                        }
                      }}
                    >
                      {entry.name}
                      {entry.quantity != null && (
                        <span className="pantry-shopping-qty">
                          {" "}
                          ({entry.quantity}
                          {entry.unit ? ` ${entry.unit}` : ""})
                        </span>
                      )}
                      {entry.note && <span className="pantry-shopping-note"> - {entry.note}</span>}
                    </span>
                    <span className="pantry-shopping-item-actions">
                      <button
                        type="button"
                        className="pantry-delete-btn"
                        onClick={() => handleBought(entry)}
                        disabled={busyId === entry.id}
                      >
                        {busyId === entry.id ? "…" : "bought"}
                      </button>
                      <button
                        type="button"
                        className="pantry-shopping-remove-btn"
                        onClick={() => handleRemove(entry.id)}
                        disabled={busyId === entry.id}
                        aria-label={`Remove ${entry.name} without buying it`}
                        title="Remove without buying"
                      >
                        ✕
                      </button>
                    </span>
                  </li>
                )
              )}
            </ul>
          )}

          <PantryInlineAddToggle placeholder="Item to buy..." toggleLabel="+ add item" onAdd={handleAdd} />
        </>
      )}
    </section>
  );
}
