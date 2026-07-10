import { useState } from "react";
import QuantityStepper from "./QuantityStepper";
import PantryEditItemModal from "./PantryEditItemModal";
import { formatExpiresAt, formatPurchasedAt } from "../lib/dates";
import {
  runPantryQuery,
  REMOVE_INVENTORY_ITEM_MUTATION,
  UPDATE_INVENTORY_ITEM_MUTATION,
  type InventoryItem,
  type RemoveInventoryItemResult,
  type UpdateInventoryItemResult,
} from "../lib/pantryGraphql";

interface PantryItemRowProps {
  item: InventoryItem;
  simple: boolean;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}

// Every optional field is either a real value or null - never an empty
// string - so a plain truthy/`!== null` check is enough to skip absent ones
// without ever rendering the literal word "null". Dates are relative ("9d
// ago" / "expires in 5d") rather than absolute - shorter, and reads more
// usefully at a glance than a raw ISO date.
function formatMeta(item: InventoryItem): string {
  const parts = [item.unit ? `${item.quantity} ${item.unit}` : `${item.quantity}`];
  if (item.price !== null) parts.push(`$${item.price.toFixed(2)}`);
  if (item.purchasedAt) parts.push(formatPurchasedAt(item.purchasedAt));
  if (item.expiresAt) parts.push(formatExpiresAt(item.expiresAt));
  return parts.join(" · ");
}

export default function PantryItemRow({ item, simple, onChanged, onError }: PantryItemRowProps) {
  const [busy, setBusy] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(item.name);
  const [showHistory, setShowHistory] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  async function saveField(input: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      await runPantryQuery<UpdateInventoryItemResult>(UPDATE_INVENTORY_ITEM_MUTATION, { id: item.id, input });
      // Awaited so `busy` doesn't clear (re-enabling e.g. the staple star)
      // until fresh data has actually landed in props - otherwise a quick
      // second click computes its next value off the stale `item` still
      // sitting in this render, which looked like the toggle getting stuck
      // rather than flipping back.
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to update item.");
    } finally {
      setBusy(false);
    }
  }

  // The stepper covers both directions (stock adjustment), while the
  // separate delete button is the fast path for removing the whole row
  // regardless of quantity rather than clicking "-" down to zero.
  async function handleQuantityChange(next: number) {
    if (busy) return;
    if (next <= 0) {
      setBusy(true);
      try {
        await runPantryQuery<RemoveInventoryItemResult>(REMOVE_INVENTORY_ITEM_MUTATION, { id: item.id });
        await onChanged();
      } catch (err) {
        onError(err instanceof Error ? err.message : "Failed to update item.");
      } finally {
        setBusy(false);
      }
      return;
    }
    await saveField({ quantity: next });
  }

  async function handleDelete() {
    if (busy) return;
    setBusy(true);
    try {
      await runPantryQuery<RemoveInventoryItemResult>(REMOVE_INVENTORY_ITEM_MUTATION, { id: item.id });
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to remove item.");
    } finally {
      setBusy(false);
    }
  }

  function commitNameEdit() {
    const trimmed = draftName.trim();
    setEditingName(false);
    if (!trimmed || trimmed === item.name) {
      setDraftName(item.name);
      return;
    }
    saveField({ name: trimmed });
  }

  // Simple mode is deliberately name + stepper + delete only - no meta line,
  // category, staple toggle, or rename/history interactions - for keeping
  // the page scannable (especially on mobile) when you don't need the detail.
  if (simple) {
    return (
      <li className="pantry-item-row pantry-item-row-simple">
        <span className="pantry-item-name">{item.name}</span>
        <div className="pantry-item-controls">
          <QuantityStepper value={item.quantity} onChange={handleQuantityChange} min={0} disabled={busy} />
          <button type="button" className="pantry-delete-btn" onClick={handleDelete} disabled={busy}>
            delete
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="pantry-item-row">
      <div className="pantry-item-info">
        {editingName ? (
          <input
            className="pantry-item-name-input"
            value={draftName}
            autoFocus
            maxLength={200}
            disabled={busy}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitNameEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitNameEdit();
              if (e.key === "Escape") {
                setDraftName(item.name);
                setEditingName(false);
              }
            }}
          />
        ) : (
          <span
            className="pantry-item-name"
            role="button"
            tabIndex={0}
            title="Click to rename"
            onClick={() => setEditingName(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setEditingName(true);
              }
            }}
          >
            {item.name}
          </span>
        )}
        {item.category && <span className="pantry-item-category">{item.category}</span>}
        <button
          type="button"
          className={`pantry-staple-toggle ${item.isStaple ? "active" : ""}`}
          title={item.isStaple ? "Staple - always keep stocked" : "Mark as a staple item"}
          onClick={() => saveField({ isStaple: !item.isStaple })}
          disabled={busy}
        >
          ★
        </button>
      </div>
      <button
        type="button"
        className="pantry-item-meta"
        onClick={() => setShowHistory((v) => !v)}
        disabled={item.purchases.length === 0}
        title={item.purchases.length > 0 ? "Click for purchase history" : undefined}
      >
        {formatMeta(item)}
      </button>
      <div className="pantry-item-controls">
        <QuantityStepper value={item.quantity} onChange={handleQuantityChange} min={0} disabled={busy} />
        <button type="button" className="pantry-edit-btn" onClick={() => setShowEdit(true)} disabled={busy}>
          edit
        </button>
        <button type="button" className="pantry-delete-btn" onClick={handleDelete} disabled={busy}>
          delete
        </button>
      </div>

      {showHistory && item.purchases.length > 0 && (
        <ul className="pantry-purchase-history">
          {[...item.purchases].reverse().map((p, i) => (
            <li key={i}>
              {p.date} — {p.quantity}
              {item.unit ? ` ${item.unit}` : ""}
              {p.price !== null ? ` · $${p.price.toFixed(2)}` : ""}
            </li>
          ))}
        </ul>
      )}

      {showEdit && (
        <PantryEditItemModal
          item={item}
          busy={busy}
          onClose={() => setShowEdit(false)}
          onSave={saveField}
        />
      )}
    </li>
  );
}
