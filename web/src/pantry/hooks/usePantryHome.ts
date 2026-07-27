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
import { clearPantryHomeCache, readPantryHomeCache, writePantryHomeCache } from "../lib/homeCache";

// Pantry.tsx's own data hook - fetches inventory + shoppingList + settings
// in one request (see PANTRY_HOME_QUERY's comment) rather than each list
// having its own hook/request the way usePantryInventory/
// usePantryShoppingList used to. PantrySettingsPage still uses
// usePantrySettings standalone - it only ever needed the one query, so it
// was never part of this waterfall.
//
// State starts from the last cached response (lib/homeCache.ts) instead of
// null, so the page paints its last-known contents on mount instead of a
// blank gap while the effect below's network request is in flight. That
// request always still fires - this is stale-while-revalidate, not an
// alternative to fetching, so the page self-corrects within one round trip
// if the cache is out of date (or missing entirely, on a first visit).
// Gated by settings.instantLoadCache (see PantrySettingsPage.tsx's "Instant
// load" toggle) - see the two uses below for how each side of that applies.
export function usePantryHome() {
  const cachedHome = readPantryHomeCache();
  // `!== false` (rather than requiring an explicit true) so a cache entry
  // written before this field existed still hydrates, matching the server
  // default in services/settings.ts's DEFAULT_SETTINGS.
  const initialHome = cachedHome?.settings.instantLoadCache !== false ? cachedHome : null;

  const [items, setItems] = useState<InventoryItem[] | null>(initialHome?.inventory ?? null);
  const [shoppingList, setShoppingList] = useState<ShoppingListEntry[] | null>(
    initialHome?.shoppingList ?? null
  );
  const [settings, setSettings] = useState<PantrySettings | null>(initialHome?.settings ?? null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    return runPantryQuery<PantryHomeQueryResult>(PANTRY_HOME_QUERY)
      .then((res) => {
        setItems(res.inventory);
        setShoppingList(res.shoppingList);
        setSettings(res.settings);
        setError(null);
        if (res.settings.instantLoadCache) {
          writePantryHomeCache(res);
        } else {
          // Actively drop it rather than just skipping the write, so
          // turning the setting off also clears out whatever was cached
          // while it was on - not just from this point forward.
          clearPantryHomeCache();
        }
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
