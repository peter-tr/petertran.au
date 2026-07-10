// Trimmed to the units actually in use - the pantry API's normalizeUnit
// alias table (api/src/pantry/normalize.ts) still recognizes more than this,
// so anything added directly via the API still normalizes fine.
export const UNIT_OPTIONS = ["pcs", "g", "kg", "mg", "L", "mL"];
