import type { LastKnownPrice } from "../api";

// Written asynchronously by the daily price-check Lambda, not on this
// request - "pending" and "unconfirmed" are both real, expected states, not
// errors, so they get plain text rather than looking broken. Shared between
// inventory rows and shopping list rows, since both can independently set
// trackPrice.
export function formatLastKnownPrice(price: LastKnownPrice | null): string {
  if (!price) return "price check pending";
  if (price.colesPrice === null) return "price unconfirmed";
  return `Coles $${price.colesPrice.toFixed(2)}`;
}

// Only link out once there's an actual price to show - nothing to send
// someone to for "pending"/"unconfirmed". Prefer the exact product page the
// price check itself found; fall back to a plain Coles search for the item
// name (a real, always-valid URL, not a guess) when it didn't capture one.
export function colesLinkFor(name: string, price: LastKnownPrice | null): string | null {
  if (!price || price.colesPrice === null) return null;
  return price.productUrl ?? `https://www.coles.com.au/search?q=${encodeURIComponent(name)}`;
}
