import { useCallback, useEffect, useState } from "react";

// Per-browser preference (like useShowAlsoBuilt) for whether Home fires its
// warmUp() pings on load - see web/src/shared/warmUp.ts. Independent of
// Provisioned Concurrency (usePcConfig): this one only tightens the timing
// for *this* visitor, right before they're likely to navigate to
// /pantry or /imposter, rather than relying on PC's scheduled window.
// Defaults to on, matching the original unconditional behavior.
const STORAGE_KEY = "portfolio:pageLoadWarmup";

function readStoredValue(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return true;

    return raw === "true";
  } catch {
    return true;
  }
}

export function usePageLoadWarmup() {
  const [pageLoadWarmup, setPageLoadWarmupState] = useState(readStoredValue);

  useEffect(() => {
    function handleStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) setPageLoadWarmupState(readStoredValue());
    }
    window.addEventListener("storage", handleStorage);

    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const setPageLoadWarmup = useCallback((value: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      // Fail silently -- this preference is a convenience, not a requirement.
    }
    setPageLoadWarmupState(value);
  }, []);

  return { pageLoadWarmup, setPageLoadWarmup };
}
