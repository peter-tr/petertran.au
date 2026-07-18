import { useCallback, useEffect, useState } from "react";
import {
  runPantryQuery,
  PANTRY_HOME_QUERY,
  UPDATE_SETTINGS_MUTATION,
  type InventoryItem,
  type ShoppingListEntry,
  type PantrySettings,
  type PantrySettingsInput,
  type PantryHomeQueryResult,
  type UpdateSettingsResult,
} from "../api";
import { mergeSettings } from "./usePantrySettings";

// Pantry.tsx's own data hook - fetches inventory + shoppingList + settings
// in one request (see PANTRY_HOME_QUERY's comment) rather than each list
// having its own hook/request the way usePantryInventory/
// usePantryShoppingList used to. PantrySettingsPage still uses
// usePantrySettings standalone - it only ever needed the one query, so it
// was never part of this waterfall.
export function usePantryHome() {
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [shoppingList, setShoppingList] = useState<ShoppingListEntry[] | null>(null);
  const [settings, setSettings] = useState<PantrySettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    return runPantryQuery<PantryHomeQueryResult>(PANTRY_HOME_QUERY)
      .then((res) => {
        setItems(res.inventory);
        setShoppingList(res.shoppingList);
        setSettings(res.settings);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  // Same optimistic-apply-then-persist pattern as usePantrySettings.
  const updateSettings = useCallback((partial: PantrySettingsInput) => {
    setSettings((prev) => (prev ? mergeSettings(prev, partial) : prev));
    runPantryQuery<UpdateSettingsResult>(UPDATE_SETTINGS_MUTATION, { input: partial }).catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    });
  }, []);

  return { items, shoppingList, settings, error, refetch, updateSettings };
}
