import { useCallback, useEffect, useState } from "react";

// Per-browser preference (like usePageLoadWarmup) for whether Home delays
// Footer/SystemStatsSection's initial fetch after Hero's. portfolio-graphql's
// Provisioned Concurrency only covers 2 warm instances, but Home fires 3
// concurrent requests (Hero, SystemStatsSection, Footer) on mount - without a
// stagger, all three race for those 2 slots and Hero cold-starts as often as
// the other two. Delaying the other two by STAGGER_DELAY_MS lets Hero's
// request land first and reliably claim a warm slot, since Hero is the
// above-the-fold content visitors actually wait on. Defaults to on.
const STORAGE_KEY = "portfolio:staggerHomeFetches";

export const STAGGER_DELAY_MS = 200;

function readStoredValue(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return true;

    return raw === "true";
  } catch {
    return true;
  }
}

export function useStaggerHomeFetches() {
  const [staggerHomeFetches, setStaggerHomeFetchesState] = useState(readStoredValue);

  useEffect(() => {
    function handleStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) setStaggerHomeFetchesState(readStoredValue());
    }
    window.addEventListener("storage", handleStorage);

    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const setStaggerHomeFetches = useCallback((value: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      // Fail silently -- this preference is a convenience, not a requirement.
    }
    setStaggerHomeFetchesState(value);
  }, []);

  return { staggerHomeFetches, setStaggerHomeFetches };
}
