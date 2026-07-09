import PantryAddItemSection from "../components/PantryAddItemSection";
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

  function refetchAll() {
    refetch();
    refetchShoppingList();
  }

  return (
    <>
      <header className="pantry-head">
        <h1>Pantry</h1>
      </header>

      {error && (
        <p className="status-line">// couldn&apos;t load inventory from the API right now ({error}).</p>
      )}

      {shoppingList && <PantryShoppingListSection entries={shoppingList} onChanged={refetchShoppingList} />}

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
