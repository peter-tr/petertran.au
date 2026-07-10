import { useState } from "react";
import PantryItemRow from "./PantryItemRow";
import { daysBetween } from "../../shared/lib/dates";
import type { InventoryItem, PantrySettings, PantrySettingsInput, StorageLocation } from "../api";

type ViewMode = "location" | "category" | "expiry" | "all";
type SortMode = "recent" | "name" | "expiry" | "quantity";

interface Group {
  key: string;
  label: string;
  items: InventoryItem[];
}

const LOCATIONS: { key: StorageLocation; label: string }[] = [
  { key: "FRIDGE", label: "Fridge" },
  { key: "FREEZER", label: "Freezer" },
  { key: "PANTRY", label: "Pantry" },
];

const EXPIRY_SOON_DAYS = 7;

// Applied within every group regardless of view, so "sort by name" still
// alphabetizes each location/category/expiry bucket rather than only
// working in the flat "All" view.
function sortItems(items: InventoryItem[], sort: SortMode): InventoryItem[] {
  const copy = [...items];
  switch (sort) {
    case "name":
      return copy.sort((a, b) => a.name.localeCompare(b.name));
    case "expiry":
      return copy.sort((a, b) => {
        if (!a.expiresAt && !b.expiresAt) return 0;
        if (!a.expiresAt) return 1;
        if (!b.expiresAt) return -1;
        return a.expiresAt.localeCompare(b.expiresAt);
      });
    case "quantity":
      return copy.sort((a, b) => b.quantity - a.quantity);
    case "recent":
    default:
      return copy.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }
}

function groupItems(items: InventoryItem[], view: ViewMode, sort: SortMode): Group[] {
  if (view === "location") {
    return LOCATIONS.map(({ key, label }) => ({
      key,
      label,
      items: sortItems(
        items.filter((i) => i.location === key),
        sort
      ),
    })).filter((g) => g.items.length > 0);
  }

  if (view === "category") {
    const byCategory = new Map<string, InventoryItem[]>();
    for (const item of items) {
      const key = item.category ?? "Uncategorized";
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key)!.push(item);
    }
    return [...byCategory.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, groupItems]) => ({ key, label: key, items: sortItems(groupItems, sort) }));
  }

  if (view === "expiry") {
    const soon: InventoryItem[] = [];
    const later: InventoryItem[] = [];
    const none: InventoryItem[] = [];
    for (const item of items) {
      if (!item.expiresAt) none.push(item);
      else if (daysBetween(item.expiresAt) <= EXPIRY_SOON_DAYS) soon.push(item);
      else later.push(item);
    }
    return [
      { key: "soon", label: "Expiring soon", items: sortItems(soon, sort) },
      { key: "later", label: "Later", items: sortItems(later, sort) },
      { key: "none", label: "No expiry date", items: sortItems(none, sort) },
    ].filter((g) => g.items.length > 0);
  }

  // "all" - one flat list.
  return [{ key: "all", label: "All items", items: sortItems(items, sort) }];
}

const VIEW_LABELS: Record<ViewMode, string> = {
  location: "Location",
  category: "Category",
  expiry: "Expiry",
  all: "All",
};

const SORT_LABELS: Record<SortMode, string> = {
  recent: "Recent",
  name: "Name",
  expiry: "Expiry",
  quantity: "Quantity",
};

function isViewMode(v: string): v is ViewMode {
  return v in VIEW_LABELS;
}

function isSortMode(v: string): v is SortMode {
  return v in SORT_LABELS;
}

interface PantryInventorySectionProps {
  items: InventoryItem[];
  settings: PantrySettings;
  onSettingsChange: (partial: PantrySettingsInput) => void;
  onChanged: () => Promise<void>;
}

export default function PantryInventorySection({
  items,
  settings,
  onSettingsChange,
  onChanged,
}: PantryInventorySectionProps) {
  const [error, setError] = useState<string | null>(null);

  const view: ViewMode = isViewMode(settings.view) ? settings.view : "location";
  const sort: SortMode = isSortMode(settings.sort) ? settings.sort : "recent";
  const collapsed = new Set(settings.collapsedGroups);

  function toggleGroup(groupKey: string) {
    const id = `${view}:${groupKey}`;
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSettingsChange({ collapsedGroups: [...next] });
  }

  const categories = [...new Set(items.map((i) => i.category).filter((c): c is string => !!c))].sort();

  // Keyed off the total count, not how many are *currently* hidden - the
  // latter goes to 0 the moment showLowPriority flips on, which made the
  // toggle button itself disappear with no way to turn it back off.
  const lowPriorityCount = items.filter((i) => i.lowPriority).length;
  const visibleItems = settings.showLowPriority ? items : items.filter((i) => !i.lowPriority);

  const filteredItems = settings.categoryFilter
    ? visibleItems.filter((i) => i.category === settings.categoryFilter)
    : visibleItems;

  const groups = groupItems(filteredItems, view, sort);

  return (
    <section className="pantry-panel">
      <div className="pantry-panel-header">
        <h2 className="pantry-panel-title">Inventory</h2>
        <button
          type="button"
          className="pantry-details-toggle"
          onClick={() => onSettingsChange({ optionsCollapsed: !settings.optionsCollapsed })}
        >
          {settings.optionsCollapsed ? "+ options" : "− options"}
        </button>
      </div>

      {!settings.optionsCollapsed && (
        <div className="pantry-panel-header-controls">
          <div className="pantry-control-group">
            <span className="pantry-control-label">Group by</span>
            <div className="pantry-view-tabs">
              {(Object.keys(VIEW_LABELS) as ViewMode[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`pantry-view-tab ${view === v ? "active" : ""}`}
                  onClick={() => onSettingsChange({ view: v })}
                >
                  {VIEW_LABELS[v]}
                </button>
              ))}
            </div>
          </div>
          <div className="pantry-control-group">
            <span className="pantry-control-label">Sort by</span>
            <div className="pantry-view-tabs">
              {(Object.keys(SORT_LABELS) as SortMode[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`pantry-view-tab ${sort === s ? "active" : ""}`}
                  onClick={() => onSettingsChange({ sort: s })}
                >
                  {SORT_LABELS[s]}
                </button>
              ))}
            </div>
          </div>
          <div className="pantry-control-group">
            <span className="pantry-control-label">Show</span>
            <div className="pantry-view-tabs">
              <button
                type="button"
                className={`pantry-view-tab ${!settings.simple ? "active" : ""}`}
                onClick={() => onSettingsChange({ simple: false })}
              >
                Details
              </button>
              <button
                type="button"
                className={`pantry-view-tab ${settings.simple ? "active" : ""}`}
                onClick={() => onSettingsChange({ simple: true })}
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
                value={settings.categoryFilter ?? ""}
                onChange={(e) => onSettingsChange({ categoryFilter: e.target.value || null })}
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
        </div>
      )}

      {error && <p className="status-line">// {error}</p>}

      {!settings.simple && (
        <p className="pantry-legend">
          <span className="pantry-staple-toggle active">★</span> staple
          <span className="pantry-low-priority-toggle-btn active">↓</span> low priority
          <span className="pantry-nearly-empty-toggle active">!</span> nearly empty
        </p>
      )}

      {lowPriorityCount > 0 && (
        <button
          type="button"
          className="pantry-details-toggle pantry-low-priority-toggle"
          onClick={() => onSettingsChange({ showLowPriority: !settings.showLowPriority })}
        >
          {settings.showLowPriority ? "− hide low priority" : `+ show ${lowPriorityCount} low priority`}
        </button>
      )}

      {items.length === 0 ? (
        <p className="status-line">// nothing tracked yet - add your first item below.</p>
      ) : filteredItems.length === 0 ? (
        <p className="status-line">// no items match the current filters.</p>
      ) : (
        groups.map((group) => {
          const groupId = `${view}:${group.key}`;
          const isCollapsed = collapsed.has(groupId);
          return (
            <div key={group.key} className="pantry-location-group">
              <button
                type="button"
                className="pantry-location-heading"
                onClick={() => toggleGroup(group.key)}
              >
                <span className="pantry-collapse-caret">{isCollapsed ? "▸" : "▾"}</span>
                {group.label}
                <span className="pantry-group-count">({group.items.length})</span>
              </button>
              {!isCollapsed && (
                <ul className="pantry-item-list">
                  {group.items.map((item) => (
                    <PantryItemRow
                      key={item.id}
                      item={item}
                      simple={settings.simple}
                      categories={settings.categories}
                      onAddCategory={(name) =>
                        onSettingsChange({ categories: [...settings.categories, name] })
                      }
                      onChanged={onChanged}
                      onError={setError}
                    />
                  ))}
                </ul>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}
