import { useCallback, useEffect, useState } from "react";
import {
  runPantryQuery,
  SHOPPING_LIST_QUERY,
  type ShoppingListEntry,
  type ShoppingListQueryResult,
} from "../lib/pantryGraphql";

export function usePantryShoppingList() {
  const [entries, setEntries] = useState<ShoppingListEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    return runPantryQuery<ShoppingListQueryResult>(SHOPPING_LIST_QUERY)
      .then((res) => {
        setEntries(res.shoppingList);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { entries, error, refetch };
}
