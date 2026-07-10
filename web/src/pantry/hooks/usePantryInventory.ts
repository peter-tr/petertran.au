import { useCallback, useEffect, useState } from "react";
import { runPantryQuery, INVENTORY_QUERY, type InventoryItem, type InventoryQueryResult } from "../api";

export function usePantryInventory() {
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    return runPantryQuery<InventoryQueryResult>(INVENTORY_QUERY)
      .then((res) => {
        setItems(res.inventory);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { items, error, refetch };
}
