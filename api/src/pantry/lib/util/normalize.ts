// Crude English de-pluralization so "egg"/"eggs"/"Egg"/" EGGS " all match as
// the same item when deciding whether to merge a purchase into an existing
// row. Not linguistically complete - just enough for common grocery-name
// patterns (plain "s", "es" after s/x/z/ch/sh, and "ies" -> "y").
export function normalizeItemName(name: string): string {
  let n = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (/[^aeiou]ies$/.test(n)) {
    n = n.slice(0, -3) + "y"; // berries -> berry
  } else if (/(s|x|z|ch|sh)es$/.test(n)) {
    n = n.slice(0, -2); // tomatoes -> tomato, boxes -> box
  } else if (/s$/.test(n) && !/ss$/.test(n)) {
    n = n.slice(0, -1); // eggs -> egg (but not "glass")
  }

  return n;
}

// Unlike item names, units are a small closed vocabulary, so rather than
// just matching loosely, this canonicalizes the stored value itself -
// "g"/"gram"/"Grams"/" grams " all end up stored (and displayed) as "g".
const UNIT_ALIASES: Record<string, string> = {
  g: "g",
  gram: "g",
  grams: "g",
  kg: "kg",
  kilogram: "kg",
  kilograms: "kg",
  mg: "mg",
  milligram: "mg",
  milligrams: "mg",
  l: "L",
  liter: "L",
  liters: "L",
  litre: "L",
  litres: "L",
  ml: "mL",
  milliliter: "mL",
  milliliters: "mL",
  millilitre: "mL",
  millilitres: "mL",
  pc: "pcs",
  pcs: "pcs",
  piece: "pcs",
  pieces: "pcs",
  pack: "pack",
  packs: "pack",
  pk: "pack",
  box: "box",
  boxes: "box",
  bottle: "bottle",
  bottles: "bottle",
  can: "can",
  cans: "can",
  bag: "bag",
  bags: "bag",
  dozen: "dozen",
  doz: "dozen",
};

// Falls back to the trimmed-but-otherwise-unchanged input for anything not
// in the table, so an unrecognized unit (e.g. "sheets") still gets stored
// tidily rather than rejected.
export function normalizeUnit(unit: string | null | undefined): string | null {
  if (!unit) return null;

  const trimmed = unit.trim();
  if (!trimmed) return null;

  return UNIT_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}
