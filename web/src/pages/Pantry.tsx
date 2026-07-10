import PantryAddItemSection from "../components/PantryAddItemSection";
import PantryCommandBar from "../components/PantryCommandBar";
import PantryCommonItemsSection from "../components/PantryCommonItemsSection";
import PantryInventorySection from "../components/PantryInventorySection";
import PantryShoppingListSection from "../components/PantryShoppingListSection";
import { usePantryInventory } from "../hooks/usePantryInventory";
import { usePantryShoppingList } from "../hooks/usePantryShoppingList";
import { usePantrySettings } from "../hooks/usePantrySettings";

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
      <header className="pantry-head">
        <h1>Pantry</h1>
      </header>

      {error && (
        <p className="status-line">// couldn&apos;t load inventory from the API right now ({error}).</p>
      )}

      <PantryCommandBar onChanged={refetchAll} />

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
          <PantryCommonItemsSection
            commonItems={settings.commonItems}
            onCommonItemsChange={(commonItems) => updateSettings({ commonItems })}
            onAdded={refetchAll}
          />
          <PantryAddItemSection onAdded={refetchAll} />
        </>
      )}
    </>
  );
}
