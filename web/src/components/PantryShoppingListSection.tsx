import { useState } from "react";
import PantryInlineAddToggle from "./PantryInlineAddToggle";
import {
  runPantryQuery,
  ADD_TO_SHOPPING_LIST_MUTATION,
  RECORD_PURCHASE_MUTATION,
  REMOVE_FROM_SHOPPING_LIST_MUTATION,
  type AddToShoppingListResult,
  type InventoryItem,
  type PantrySettings,
  type PantrySettingsInput,
  type RecordPurchaseResult,
  type RemoveFromShoppingListResult,
  type ShoppingListEntry,
} from "../lib/pantryGraphql";

interface PantryShoppingListSectionProps {
  entries: ShoppingListEntry[];
  items: InventoryItem[];
  settings: PantrySettings;
  onSettingsChange: (input: PantrySettingsInput) => void;
  onChanged: () => void;
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
        },
      });
      await runPantryQuery<RemoveFromShoppingListResult>(REMOVE_FROM_SHOPPING_LIST_MUTATION, { id: entry.id });
      onChanged();
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
      onChanged();
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
      onChanged();
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
              {entries.map((entry) => (
                <li key={entry.id} className="pantry-shopping-item">
                  <span>
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
              ))}
            </ul>
          )}

          <PantryInlineAddToggle placeholder="Item to buy..." toggleLabel="+ add item" onAdd={handleAdd} />
        </>
      )}
    </section>
  );
}
