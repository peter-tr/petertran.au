// Mirrors every canonical unit the backend's normalizeUnit alias table
// (api/src/pantry/lib/util/normalize.ts) recognizes - the AI or the API
// itself can set any of these (e.g. "bottle" for lemon juice), and this list
// needs to stay a superset of that so the add/edit unit <select> always has
// a matching option instead of silently showing the wrong value.
export const UNIT_OPTIONS = [
  "pcs",
  "g",
  "kg",
  "mg",
  "L",
  "mL",
  "pack",
  "box",
  "bottle",
  "can",
  "bag",
  "dozen",
];

// Grams and millilitres are tracked in quantities large enough that
// stepping by 1 at a time is impractically slow - 100 at a time matches how
// these are actually bought/used (e.g. a 500g bag, a 250mL bottle).
export function stepForUnit(unit: string | null | undefined): number {
  return unit === "g" || unit === "mL" ? 100 : 1;
}
