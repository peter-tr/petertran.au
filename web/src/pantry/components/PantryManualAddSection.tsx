import PantryAddItemSection from "./PantryAddItemSection";
import PantryCommonItemsSection from "./PantryCommonItemsSection";
import type { PantrySettings, PantrySettingsInput } from "../api";

interface PantryManualAddSectionProps {
  commonItems: string[];
  onCommonItemsChange: (next: string[]) => void;
  settings: PantrySettings;
  onSettingsChange: (partial: PantrySettingsInput) => void;
  onAdded: () => Promise<void>;
}

// Common items and the full add-item form are really one "quickly log
// something manually" area - grouped under a single collapsible panel
// (title + hide/show) instead of each having its own, so there's one
// toggle to reason about instead of two that could drift out of sync.
export default function PantryManualAddSection({
  commonItems,
  onCommonItemsChange,
  settings,
  onSettingsChange,
  onAdded,
}: PantryManualAddSectionProps) {
  return (
    <section className="pantry-panel">
      <div className="pantry-panel-header">
        <h2 className="pantry-panel-title">Manual add</h2>
        <button
          type="button"
          className="pantry-details-toggle"
          onClick={() => onSettingsChange({ commonItemsCollapsed: !settings.commonItemsCollapsed })}
        >
          {settings.commonItemsCollapsed ? "+ show" : "− hide"}
        </button>
      </div>

      {!settings.commonItemsCollapsed && (
        <>
          <PantryCommonItemsSection
            commonItems={commonItems}
            onCommonItemsChange={onCommonItemsChange}
            onAdded={onAdded}
          />
          <PantryAddItemSection settings={settings} onSettingsChange={onSettingsChange} onAdded={onAdded} />
        </>
      )}
    </section>
  );
}
