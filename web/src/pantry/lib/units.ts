// Trimmed to the units actually in use - the pantry API's normalizeUnit
// alias table (api/src/pantry/normalize.ts) still recognizes more than this,
// so anything added directly via the API still normalizes fine.
export const UNIT_OPTIONS = ["pcs", "g", "kg", "mg", "L", "mL"];

// Grams and millilitres are tracked in quantities large enough that
// stepping by 1 at a time is impractically slow - 100 at a time matches how
// these are actually bought/used (e.g. a 500g bag, a 250mL bottle).
export function stepForUnit(unit: string | null | undefined): number {
  return unit === "g" || unit === "mL" ? 100 : 1;
}
