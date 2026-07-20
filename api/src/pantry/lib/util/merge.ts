// Shallow-merges `updates` onto `base`, skipping any key whose value is
// undefined - GraphQL update inputs use undefined to mean "field omitted",
// not "clear this field", so a naive spread would blow away existing values
// on every partial update. `updates`' value type is widened to allow `| null`
// on top of T[K] because some update inputs (e.g. UpdateInventoryItemInput's
// isStaple) accept null even where the stored field is non-nullable - the
// filter only ever drops `undefined`, matching this function's callers'
// prior inline behavior exactly.
export function mergeDefined<T extends object>(base: T, updates: { [K in keyof T]?: T[K] | null }): T {
  return {
    ...base,
    ...Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined)),
  } as T;
}
