// Trims floating-point noise (e.g. 2.0000000004) and drops a trailing ".0"
// so scaled amounts read like something a person would type, not a
// calculator.
function formatNumber(n: number): string {
  return Number(n.toFixed(2)).toString();
}

// Replaces the leading number in a recipe ingredient's freeform amount
// string with a servings-scaled value - e.g. ("2.5 cups", 2.5, 2) ->
// "5 cups". `quantity` is the ingredient's leading numeric amount at
// baseServings; 0 means the amount wasn't cleanly scalable (a range, "to
// taste", etc.), in which case the original text is returned unchanged -
// that's the intended, honest behavior, not a bug.
export function scaleAmount(amount: string | null, quantity: number, ratio: number): string | null {
  if (!amount || quantity <= 0 || ratio === 1) return amount;

  const scaled = formatNumber(quantity * ratio);

  return amount.replace(/^[\d.]+/, scaled);
}

// Same scalability rule as scaleAmount - a price only scales when its
// ingredient's amount does.
export function scalePrice(estimatedPriceAud: number, quantity: number, ratio: number): number {
  return quantity > 0 ? estimatedPriceAud * ratio : estimatedPriceAud;
}

type UnitGroup = "mass" | "volume" | "count";

// Conversion factor to a common base unit per group (grams, mL, and a
// bare "piece" count respectively). Anything not listed as mass/volume -
// pack, box, bottle, can, bag - is deliberately excluded from THOSE groups:
// those have no fixed size, so there's nothing safe to convert. They (and
// everything else - "large", "cloves", "medium", no unit at all...) fall
// through to "count" instead of "unrecognized", since a recipe amount
// without a real mass/volume unit is almost always just "N of the
// ingredient" - "14 large" onions is still a count of 14, comparable to an
// inventory item tracked by plain quantity.
const MASS_TO_GRAMS: Record<string, number> = {
  mg: 0.001,
  g: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  kilogram: 1000,
  kilograms: 1000,
};
const VOLUME_TO_ML: Record<string, number> = {
  ml: 1,
  milliliter: 1,
  milliliters: 1,
  l: 1000,
  liter: 1000,
  liters: 1000,
  litre: 1000,
  litres: 1000,
  tsp: 5,
  teaspoon: 5,
  teaspoons: 5,
  tbsp: 15,
  tablespoon: 15,
  tablespoons: 15,
  cup: 250,
  cups: 250,
};
const DOZEN_ALIASES = new Set(["dozen", "doz"]);

function classify(unit: string): { group: UnitGroup; factor: number } {
  const key = unit.trim().toLowerCase();
  if (key in MASS_TO_GRAMS) return { group: "mass", factor: MASS_TO_GRAMS[key] };
  if (key in VOLUME_TO_ML) return { group: "volume", factor: VOLUME_TO_ML[key] };
  if (DOZEN_ALIASES.has(key)) return { group: "count", factor: 12 };

  return { group: "count", factor: 1 };
}

// A recipe ingredient's amount has no separate structured unit - it's
// embedded in the freeform text, e.g. "5600g" or "2.5 cups". This pulls out
// whatever follows the leading number (possibly empty, e.g. "3" alone).
function trailingUnit(amount: string): string {
  return amount.replace(/^[\d.]+\s*/, "").trim();
}

export type Sufficiency = "sufficient" | "insufficient" | "unknown";

// Compares a recipe ingredient's servings-scaled requirement against what's
// actually in inventory. Returns "unknown" (never a guess) whenever the
// comparison can't be made safely - no clean numeric quantity, no matched
// inventory item, or units that genuinely aren't the same kind of thing
// (e.g. the recipe wants "5600g" but the matched item is tracked in "mL").
// The caller falls back to the AI's own haveInInventory flag in that case,
// rather than treating "unknown" as either have or missing.
export function checkSufficiency(
  amount: string | null,
  quantity: number,
  ratio: number,
  matchedItem: { quantity: number; unit: string | null } | null
): Sufficiency {
  if (!amount || quantity <= 0 || !matchedItem) return "unknown";

  const recipeUnit = classify(trailingUnit(amount));
  const itemUnit = matchedItem.unit ? classify(matchedItem.unit) : { group: "count" as const, factor: 1 };
  if (recipeUnit.group !== itemUnit.group) return "unknown";

  const requiredBase = quantity * ratio * recipeUnit.factor;
  const haveBase = matchedItem.quantity * itemUnit.factor;

  return haveBase >= requiredBase ? "sufficient" : "insufficient";
}
