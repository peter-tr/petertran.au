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
