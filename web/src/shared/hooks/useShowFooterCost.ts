import { useCallback, useEffect, useState } from "react";

// Whether Footer shows the "real cost since launch" line. There's no
// login/account system on this site, so it's a per-browser preference via
// localStorage rather than anything server-backed - defaults to visible
// (true) when the key has never been set.
const STORAGE_KEY = "portfolio:showFooterCost";

function readStoredValue(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return true;

    return raw === "true";
  } catch {
    // Storage unavailable (private browsing, quota, etc.) -- just show the
    // line, same as a fresh visitor with no stored preference.
    return true;
  }
}

export function useShowFooterCost() {
  const [showFooterCost, setShowFooterCostState] = useState(readStoredValue);

  useEffect(() => {
    // Picks up the toggle if another tab (or Settings, on the way back to
    // this page) changed the stored value.
    function handleStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) setShowFooterCostState(readStoredValue());
    }
    window.addEventListener("storage", handleStorage);

    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const setShowFooterCost = useCallback((value: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      // Fail silently -- this preference is a convenience, not a requirement.
    }
    setShowFooterCostState(value);
  }, []);

  return { showFooterCost, setShowFooterCost };
}
