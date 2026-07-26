import { getPantryIdentity } from "./auth";
import type { InventoryItem, PantryHomeQueryResult, PantrySettings, ShoppingListEntry } from "../api";

// Bump this whenever PantryHomeQuery's shape changes in a way an older
// cached entry couldn't safely stand in for (e.g. a field a component
// indexes into directly rather than through `?? fallback`). A stale entry
// under the old version key is just ignored - falls back to network-only
// for that one load - rather than risk handing a component a shape it
// doesn't expect.
const CACHE_VERSION = 1;

type CachedPantryHome = Pick<PantryHomeQueryResult, "inventory" | "shoppingList" | "settings">;

function cacheKey(): string {
  return `pantry_home_cache_v${CACHE_VERSION}_${getPantryIdentity()}`;
}

// Lets Pantry.tsx paint the last-known inventory/shopping list/settings
// instantly on mount while usePantryHome's own effect fetches fresh data in
// the background - localStorage (not sessionStorage) so it survives
// closing the tab, matching how lib/auth.ts stores tokens.
export function readPantryHomeCache(): CachedPantryHome | null {
  try {
    const raw = localStorage.getItem(cacheKey());

    return raw ? (JSON.parse(raw) as CachedPantryHome) : null;
  } catch {
    return null;
  }
}

export function writePantryHomeCache(data: {
  inventory: InventoryItem[];
  shoppingList: ShoppingListEntry[];
  settings: PantrySettings;
}): void {
  try {
    localStorage.setItem(cacheKey(), JSON.stringify(data));
  } catch {
    // Quota exceeded or storage disabled (private browsing) - the cache is
    // a pure optimization, so just skip persisting rather than surface an
    // error over it.
  }
}

// Called on sign-out (see usePantryAuth.ts) so a previous account's cached
// inventory doesn't linger reachable under a stale key on a shared browser.
export function clearPantryHomeCache(): void {
  try {
    localStorage.removeItem(cacheKey());
  } catch {
    // ignore
  }
}
