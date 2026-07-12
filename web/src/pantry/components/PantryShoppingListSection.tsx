import { useState } from "react";
import PantryInlineAddToggle from "./PantryInlineAddToggle";
import PantryEditShoppingListEntryModal from "./PantryEditShoppingListEntryModal";
import { UNIT_OPTIONS } from "../lib/units";
import { formatLastKnownPrice, colesLinkFor, formatDebugInfo } from "../lib/priceDisplay";
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

// "urgent" still falls back to most-recently-added within each of the two
// groups (urgent first, then not) - never an unstable/arbitrary tiebreak.
function sortEntries(entries: ShoppingListEntry[], sort: string): ShoppingListEntry[] {
  const copy = [...entries];
  if (sort === "urgent") {
    return copy.sort((a, b) => {
      if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
      return b.addedAt.localeCompare(a.addedAt);
    });
  }
  return copy.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
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
  // The full-fields form (all of name/quantity/unit/note/category/recipe/
  // urgent/trackPrice) - separate from the inline row above, which only
  // ever handles "confirm what you actually bought" now.
  const [showEditId, setShowEditId] = useState<string | null>(null);

  // Opens the inline row in "confirm what you actually bought" mode -
  // quantity/unit are prefilled from the entry but editable before
  // recordPurchase is called, instead of blindly trusting whatever was on
  // the list.
  function startBought(entry: ShoppingListEntry) {
    setEditingId(entry.id);
    setDraft({
      name: entry.name,
      quantity: entry.quantity != null ? String(entry.quantity) : "",
      unit: entry.unit ?? "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
  }

  async function saveEditModal(id: string, input: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await runPantryQuery<UpdateShoppingListEntryResult>(UPDATE_SHOPPING_LIST_ENTRY_MUTATION, { id, input });
      await onChanged();
    } finally {
      setBusyId(null);
    }
  }

  // "Bought" means it's now actually in stock - record it as a purchase (so
  // it shows up in inventory), then drop it off the shopping list. Reuses
  // an existing inventory item's location if the name matches one, so this
  // merges instead of creating a stray duplicate in the wrong place.
  // Quantity/unit come from the (possibly edited) draft, not the entry's
  // original values, so a confirm of "actually only got 2, not 3" sticks.
  async function confirmBought(entry: ShoppingListEntry) {
    if (!draft) return;
    setBusyId(entry.id);
    setError(null);
    try {
      const needle = entry.name.trim().toLowerCase();
      const matchingItem = items.find((i) => i.name.trim().toLowerCase() === needle);
      await runPantryQuery<RecordPurchaseResult>(RECORD_PURCHASE_MUTATION, {
        input: {
          name: entry.name,
          location: matchingItem?.location ?? "PANTRY",
          quantity: draft.quantity.trim() ? Number(draft.quantity) : (entry.quantity ?? 1),
          unit: draft.unit || entry.unit,
          purchasedAt: today(),
          // Carries the staple flag and category through the remove ->
          // shopping list -> re-buy cycle instead of them silently
          // resetting.
          isStaple: entry.isStaple || matchingItem?.isStaple || false,
          category: entry.category || matchingItem?.category || null,
        },
      });
      await runPantryQuery<RemoveFromShoppingListResult>(REMOVE_FROM_SHOPPING_LIST_MUTATION, {
        id: entry.id,
      });
      cancelEdit();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record purchase.");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleUrgent(entry: ShoppingListEntry) {
    if (busyId) return;
    setBusyId(entry.id);
    setError(null);
    try {
      await runPantryQuery<UpdateShoppingListEntryResult>(UPDATE_SHOPPING_LIST_ENTRY_MUTATION, {
        id: entry.id,
        input: { urgent: !entry.urgent },
      });
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update shopping list entry.");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleTrackPrice(entry: ShoppingListEntry) {
    if (busyId) return;
    setBusyId(entry.id);
    setError(null);
    try {
      await runPantryQuery<UpdateShoppingListEntryResult>(UPDATE_SHOPPING_LIST_ENTRY_MUTATION, {
        id: entry.id,
        input: { trackPrice: !entry.trackPrice },
      });
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update shopping list entry.");
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

  const categories = [...new Set(entries.map((e) => e.category).filter((c): c is string => !!c))].sort();
  const recipeTags = [...new Set(entries.map((e) => e.recipeTag).filter((t): t is string => !!t))].sort();

  const filteredEntries = sortEntries(
    entries.filter((e) => {
      if (settings.shoppingCategoryFilter && e.category !== settings.shoppingCategoryFilter) return false;
      if (settings.shoppingRecipeFilter && e.recipeTag !== settings.shoppingRecipeFilter) return false;
      if (settings.shoppingUrgentOnly && !e.urgent) return false;
      return true;
    }),
    settings.shoppingSort
  );

  return (
    <section className="pantry-panel">
      <div className="pantry-panel-header">
        <h2 className="pantry-panel-title">Shopping list</h2>
        <button
          type="button"
          className="pantry-details-toggle"
          onClick={() => onSettingsChange({ shoppingOptionsCollapsed: !settings.shoppingOptionsCollapsed })}
        >
          {settings.shoppingOptionsCollapsed ? "+ options" : "− options"}
        </button>
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
          {!settings.shoppingOptionsCollapsed && (
            <div className="pantry-panel-header-controls">
              <div className="pantry-control-group">
                <span className="pantry-control-label">Sort by</span>
                <div className="pantry-view-tabs">
                  <button
                    type="button"
                    className={`pantry-view-tab ${settings.shoppingSort !== "urgent" ? "active" : ""}`}
                    onClick={() => onSettingsChange({ shoppingSort: "recent" })}
                  >
                    Recent
                  </button>
                  <button
                    type="button"
                    className={`pantry-view-tab ${settings.shoppingSort === "urgent" ? "active" : ""}`}
                    onClick={() => onSettingsChange({ shoppingSort: "urgent" })}
                  >
                    Urgent
                  </button>
                </div>
              </div>
              <div className="pantry-control-group">
                <span className="pantry-control-label">Show</span>
                <div className="pantry-view-tabs">
                  <button
                    type="button"
                    className={`pantry-view-tab ${!settings.shoppingSimple ? "active" : ""}`}
                    onClick={() => onSettingsChange({ shoppingSimple: false })}
                  >
                    Details
                  </button>
                  <button
                    type="button"
                    className={`pantry-view-tab ${settings.shoppingSimple ? "active" : ""}`}
                    onClick={() => onSettingsChange({ shoppingSimple: true })}
                  >
                    Simple
                  </button>
                </div>
              </div>
              {categories.length > 0 && (
                <div className="pantry-control-group">
                  <span className="pantry-control-label">Category</span>
                  <select
                    className="pantry-category-filter"
                    value={settings.shoppingCategoryFilter ?? ""}
                    onChange={(e) => onSettingsChange({ shoppingCategoryFilter: e.target.value || null })}
                  >
                    <option value="">All categories</option>
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {recipeTags.length > 0 && (
                <div className="pantry-control-group">
                  <span className="pantry-control-label">Recipe</span>
                  <select
                    className="pantry-category-filter"
                    value={settings.shoppingRecipeFilter ?? ""}
                    onChange={(e) => onSettingsChange({ shoppingRecipeFilter: e.target.value || null })}
                  >
                    <option value="">All recipes</option>
                    {recipeTags.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="pantry-control-group">
                <label className="pantry-control-label pantry-urgent-filter-label">
                  <input
                    type="checkbox"
                    checked={settings.shoppingUrgentOnly}
                    onChange={(e) => onSettingsChange({ shoppingUrgentOnly: e.target.checked })}
                  />{" "}
                  Urgent only
                </label>
              </div>
            </div>
          )}

          {entries.length > 0 && filteredEntries.length === 0 && (
            <p className="status-line">// no items match the current filters.</p>
          )}

          {filteredEntries.length > 0 && (
            <ul className="pantry-shopping-list">
              {filteredEntries.map((entry) =>
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
                          if (e.key === "Enter") confirmBought(entry);
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
                    </div>
                    <span className="pantry-shopping-item-actions">
                      <button
                        type="button"
                        className="run-btn"
                        onClick={() => confirmBought(entry)}
                        disabled={busyId === entry.id}
                      >
                        {busyId === entry.id ? "…" : "Confirm bought"}
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
                      className={`pantry-shopping-item-name ${entry.urgent ? "pantry-shopping-item-urgent" : ""}`}
                      role="button"
                      tabIndex={0}
                      title="Click to edit"
                      onClick={() => setShowEditId(entry.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setShowEditId(entry.id);
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
                      {!settings.shoppingSimple && entry.note && (
                        <span className="pantry-shopping-note"> - {entry.note}</span>
                      )}
                      {!settings.shoppingSimple && entry.category && (
                        <span className="pantry-item-category"> {entry.category}</span>
                      )}
                      {!settings.shoppingSimple && entry.recipeTag && (
                        <span className="pantry-shopping-recipe-tag"> · {entry.recipeTag}</span>
                      )}
                      {entry.trackPrice && (
                        <span className="pantry-item-last-known-price" title={entry.lastKnownPrice?.note ?? undefined}>
                          {" · "}
                          {formatLastKnownPrice(entry.lastKnownPrice)}
                        </span>
                      )}
                      {!settings.shoppingSimple && entry.trackPrice && settings.nerdModeShoppingList && entry.lastKnownPrice && (
                        <span className="pantry-nerd-debug-info">
                          {" · "}
                          {formatDebugInfo(entry.lastKnownPrice.debugInfo)}
                        </span>
                      )}
                    </span>
                    <span className="pantry-shopping-item-actions">
                      {!settings.shoppingSimple && (
                        <button
                          type="button"
                          className={`pantry-shopping-urgent-toggle ${entry.urgent ? "active" : ""}`}
                          onClick={() => toggleUrgent(entry)}
                          disabled={busyId === entry.id}
                          title={entry.urgent ? "Urgent - needed ASAP" : "Mark as urgent"}
                          aria-label={entry.urgent ? "Unmark as urgent" : "Mark as urgent"}
                        >
                          !
                        </button>
                      )}
                      {!settings.shoppingSimple && (
                        <button
                          type="button"
                          className={`pantry-track-price-toggle ${entry.trackPrice ? "active" : ""}`}
                          onClick={() => toggleTrackPrice(entry)}
                          disabled={busyId === entry.id}
                          title={
                            entry.trackPrice
                              ? "Tracking price - checked daily against Coles"
                              : "Track price (checked daily against Coles)"
                          }
                          aria-label={entry.trackPrice ? "Stop tracking price" : "Track price"}
                        >
                          $
                        </button>
                      )}
                      {!settings.shoppingSimple &&
                        entry.trackPrice &&
                        (() => {
                          const link = colesLinkFor(entry.name, entry.lastKnownPrice);
                          return (
                            link && (
                              <a
                                className="pantry-coles-link"
                                href={link}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={
                                  entry.lastKnownPrice?.productUrl
                                    ? "Open this product on Coles"
                                    : "Not the exact product priced above - a plain Coles search for this name"
                                }
                              >
                                {entry.lastKnownPrice?.productUrl ? "Coles ↗" : "Search Coles ↗"}
                              </a>
                            )
                          );
                        })()}
                      <button
                        type="button"
                        className="pantry-delete-btn"
                        onClick={() => startBought(entry)}
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

                    {showEditId === entry.id && (
                      <PantryEditShoppingListEntryModal
                        entry={entry}
                        busy={busyId === entry.id}
                        categories={settings.categories}
                        onAddCategory={(name) => onSettingsChange({ categories: [...settings.categories, name] })}
                        onClose={() => setShowEditId(null)}
                        onSave={(input) => saveEditModal(entry.id, input)}
                      />
                    )}
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
