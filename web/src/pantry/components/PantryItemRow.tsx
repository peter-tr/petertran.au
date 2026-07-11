import { useState } from "react";
import QuantityStepper from "./QuantityStepper";
import PantryEditItemModal from "./PantryEditItemModal";
import { daysBetween, formatExpiresAt, formatPurchasedAt } from "../../shared/lib/dates";
import { stepForUnit } from "../lib/units";
import {
  runPantryQuery,
  REMOVE_INVENTORY_ITEM_MUTATION,
  UPDATE_INVENTORY_ITEM_MUTATION,
  type InventoryItem,
  type LastKnownPrice,
  type RemoveInventoryItemResult,
  type UpdateInventoryItemResult,
} from "../api";

interface PantryItemRowProps {
  item: InventoryItem;
  simple: boolean;
  categories: string[];
  onAddCategory: (name: string) => void;
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
  return parts.join(" · ");
}

// Written asynchronously by the daily price-check Lambda, not on this
// request - "pending" and "unconfirmed" are both real, expected states, not
// errors, so they get plain text rather than looking broken.
function formatLastKnownPrice(price: LastKnownPrice | null): string {
  if (!price) return "price check pending";
  const parts: string[] = [];
  if (price.colesPrice !== null) parts.push(`Coles $${price.colesPrice.toFixed(2)}`);
  if (price.woolworthsPrice !== null) parts.push(`Woolworths $${price.woolworthsPrice.toFixed(2)}`);
  return parts.length > 0 ? parts.join(", ") : "price unconfirmed";
}

// Separated from the rest of the meta line so expired/soon-to-expire dates
// can get their own color without recoloring the whole "1 kg · $4.50 ·
// 2d ago" string alongside them.
function expiryClass(expiresAt: string): string {
  const days = daysBetween(expiresAt);
  if (days < 0) return "pantry-item-expiry-expired";
  if (days <= 3) return "pantry-item-expiry-soon";
  return "";
}

export default function PantryItemRow({
  item,
  simple,
  categories,
  onAddCategory,
  onChanged,
  onError,
}: PantryItemRowProps) {
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
  // The unit still shows (just the unit, not the full purchase/expiry meta
  // line) since a bare number without it is ambiguous - "2" could be 2 pcs
  // or 2 kg.
  if (simple) {
    return (
      <li className="pantry-item-row pantry-item-row-simple">
        <span className="pantry-item-name">{item.name}</span>
        <div className="pantry-item-controls">
          {item.unit && <span className="pantry-item-simple-unit">{item.unit}</span>}
          <QuantityStepper
            value={item.quantity}
            onChange={handleQuantityChange}
            min={0}
            step={stepForUnit(item.unit)}
            disabled={busy}
          />
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
        <div className="pantry-item-toggles">
          <button
            type="button"
            className={`pantry-staple-toggle ${item.isStaple ? "active" : ""}`}
            title={item.isStaple ? "Staple - always keep stocked" : "Mark as a staple item"}
            onClick={() => saveField({ isStaple: !item.isStaple })}
            disabled={busy}
          >
            ★
          </button>
          <button
            type="button"
            className={`pantry-low-priority-toggle-btn ${item.lowPriority ? "active" : ""}`}
            title={
              item.lowPriority
                ? "Low priority - hidden from the main list"
                : "Mark as low priority (rarely needs checking)"
            }
            onClick={() => saveField({ lowPriority: !item.lowPriority })}
            disabled={busy}
          >
            ↓
          </button>
          <button
            type="button"
            className={`pantry-nearly-empty-toggle ${item.nearlyEmpty ? "active" : ""}`}
            title={item.nearlyEmpty ? "Nearly empty - running low" : "Mark as nearly empty"}
            onClick={() => saveField({ nearlyEmpty: !item.nearlyEmpty })}
            disabled={busy}
          >
            !
          </button>
          <button
            type="button"
            className={`pantry-track-price-toggle ${item.trackPrice ? "active" : ""}`}
            title={
              item.trackPrice
                ? "Tracking price - checked daily against Coles/Woolworths"
                : "Track price (checked daily against Coles/Woolworths)"
            }
            onClick={() => saveField({ trackPrice: !item.trackPrice })}
            disabled={busy}
          >
            $
          </button>
        </div>
      </div>
      <button
        type="button"
        className="pantry-item-meta"
        onClick={() => setShowHistory((v) => !v)}
        disabled={item.purchases.length === 0}
        title={item.purchases.length > 0 ? "Click for purchase history" : undefined}
      >
        {item.nearlyEmpty && <span className="pantry-nearly-empty-badge">low stock</span>}
        {formatMeta(item)}
        {item.expiresAt && (
          <>
            {" · "}
            <span className={expiryClass(item.expiresAt)}>{formatExpiresAt(item.expiresAt)}</span>
          </>
        )}
        {item.trackPrice && (
          <>
            {" · "}
            <span className="pantry-item-last-known-price" title={item.lastKnownPrice?.note ?? undefined}>
              {formatLastKnownPrice(item.lastKnownPrice)}
            </span>
          </>
        )}
      </button>
      <div className="pantry-item-controls">
        <QuantityStepper
          value={item.quantity}
          onChange={handleQuantityChange}
          min={0}
          step={stepForUnit(item.unit)}
          disabled={busy}
        />
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
          categories={categories}
          onAddCategory={onAddCategory}
          onClose={() => setShowEdit(false)}
          onSave={saveField}
        />
      )}
    </li>
  );
}
