import { Link } from "react-router-dom";
import PantryCommandBar from "./components/PantryCommandBar";
import PantryInventorySection from "./components/PantryInventorySection";
import PantryManualAddSection from "./components/PantryManualAddSection";
import PantryShoppingListSection from "./components/PantryShoppingListSection";
import { usePantryInventory } from "./hooks/usePantryInventory";
import { usePantryShoppingList } from "./hooks/usePantryShoppingList";
import { usePantrySettings } from "./hooks/usePantrySettings";
import "./pantry.css";

export default function Pantry() {
  const { items, error, refetch } = usePantryInventory();
  const { entries: shoppingList, refetch: refetchShoppingList } = usePantryShoppingList();
  const { settings, updateSettings } = usePantrySettings();

  // Awaited by callers before re-enabling their own busy state (e.g. the
  // staple star toggle) - without that, a quick second click computes its
  // next value from stale props because the refetch hadn't landed yet,
  // which looked like the toggle "getting stuck" instead of flipping back.
  async function refetchAll() {
    await Promise.all([refetch(), refetchShoppingList()]);
  }

  return (
    <>
      <header className="pantry-head pantry-head-row">
        <h1>Pantry</h1>
        <Link
          to="/pantry/settings"
          className="pantry-settings-cog"
          aria-label="Pantry settings"
          title="Settings"
        >
          ⚙
        </Link>
      </header>

      {error && (
        <p className="status-line">// couldn&apos;t load inventory from the API right now ({error}).</p>
      )}

      <PantryCommandBar items={items ?? []} onChanged={refetchAll} />

      {shoppingList && items && settings && (
        <PantryShoppingListSection
          entries={shoppingList}
          items={items}
          settings={settings}
          onSettingsChange={updateSettings}
          onChanged={refetchAll}
        />
      )}

      {items && settings && (
        <>
          <PantryInventorySection
            items={items}
            settings={settings}
            onSettingsChange={updateSettings}
            onChanged={refetchAll}
          />
          <PantryManualAddSection
            commonItems={settings.commonItems}
            onCommonItemsChange={(commonItems) => updateSettings({ commonItems })}
            settings={settings}
            onSettingsChange={updateSettings}
            onAdded={refetchAll}
          />
        </>
      )}
    </>
  );
}
