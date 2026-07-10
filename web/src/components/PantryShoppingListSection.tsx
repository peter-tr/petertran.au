import { useState } from "react";
import PantryInlineAddToggle from "./PantryInlineAddToggle";
import {
  runPantryQuery,
  ADD_TO_SHOPPING_LIST_MUTATION,
  REMOVE_FROM_SHOPPING_LIST_MUTATION,
  type AddToShoppingListResult,
  type RemoveFromShoppingListResult,
  type ShoppingListEntry,
} from "../lib/pantryGraphql";

interface PantryShoppingListSectionProps {
  entries: ShoppingListEntry[];
  onChanged: () => void;
}

export default function PantryShoppingListSection({ entries, onChanged }: PantryShoppingListSectionProps) {
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleBought(id: string) {
    setRemovingId(id);
    setError(null);
    try {
      await runPantryQuery<RemoveFromShoppingListResult>(REMOVE_FROM_SHOPPING_LIST_MUTATION, { id });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update shopping list.");
    } finally {
      setRemovingId(null);
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
      <h2 className="pantry-panel-title">Shopping list</h2>

      {error && <p className="status-line">// {error}</p>}

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
              </span>
              <button
                type="button"
                className="pantry-delete-btn"
                onClick={() => handleBought(entry.id)}
                disabled={removingId === entry.id}
              >
                {removingId === entry.id ? "…" : "bought"}
              </button>
            </li>
          ))}
        </ul>
      )}

      <PantryInlineAddToggle placeholder="Item to buy..." toggleLabel="+ add item" onAdd={handleAdd} />
    </section>
  );
}
