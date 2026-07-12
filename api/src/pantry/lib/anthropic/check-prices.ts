import { getAnthropicClient } from "@shared/anthropic-client";
import { getAllItems, setLastKnownPrice, type LastKnownPrice } from "../../services/inventory";
import { getShoppingList, setShoppingListLastKnownPrice } from "../../services/shopping-list";

// Hard cap on tracked items processed per run - a safety net against cost
// blowing out if the tracked list grows large, not an expected ceiling.
const MAX_ITEMS_PER_RUN = 20;

// claude-haiku-4-5 doesn't support the newer web_search_20260209/
// web_fetch_20260209 dynamic-filtering variants, so this uses the basic
// ones - see the memory writeup: Haiku + basic tools was ~4-5x cheaper than
// Sonnet 5 + dynamic filtering for equivalent results in testing, and
// Sonnet's one completed test run spiralled into a 9.5-minute, $2.56 single
// call with no cap. max_uses + a short request timeout are load-bearing,
// not optional, given that incident.
//
// Coles only, deliberately - Woolworths' pages don't reliably surface a
// price through search/fetch (confirmed live, repeatedly), and a field
// that's usually null isn't worth showing the user at all.
const SYSTEM_PROMPT = `You look up the current Coles price (Australia) for an item in a pantry-tracking app.

Rules:
- For items sold in variable denominations (loose produce priced per kg vs per each vs per bunch, or multiple pack sizes), report the most common/representative one as the price and name any other denominations you found in the note, rather than silently picking one with no explanation.
- A confirmed exact price beats a labeled assumption, but a labeled assumption beats null - a price of null is close to useless for someone glancing at their pantry list. If a search doesn't turn up a price for the exact item name given (e.g. it's generic, missing a size/variant, or just didn't surface a clean match), don't stop at null: search again for the item's most common/standard version (e.g. the regular-flavour 12-pack for a bare brand name) and report that price, with a note explaining what you assumed (e.g. "assumed standard 12-pack - item name didn't specify a variant"). Only fall back to null if you genuinely can't find a Coles price for anything plausibly matching this item at all, not just the one exact name given.
- Never silently substitute a different item's price without saying so - the note is what makes an assumption safe to show the user, so an assumed price without a note explaining the assumption isn't good enough.
- If a search result gives you the exact Coles product page URL for the item you priced, report it. Never construct, guess, or infer a URL yourself - only report one you actually saw in a search result or fetched page. If you don't have a real URL for the specific product you priced, say null - a broken/guessed link is worse than no link.

End your response with exactly these three lines, each on its own line, using the literal word "null" (not a placeholder) when a value is unknown. COLES_PRICE must be a single plain number with no dollar sign and no range (e.g. "7.00", never "$7.00" or "0.84-6.00") - if multiple variants have different prices, pick one (the cheapest, or the most standard/common) as the number and put the others in NOTE instead:
COLES_PRICE: <a single plain number, or null>
PRODUCT_URL: <the exact coles.com.au product URL you saw for this product, or null>
NOTE: <short caveat, or null>`;

interface CheckPriceResult {
  colesPrice: number | null;
  productUrl: string | null;
  note: string | null;
}

function parseResult(text: string): CheckPriceResult {
  const colesMatch = text.match(/COLES_PRICE:\s*(null|[\d.]+)/i);
  const urlMatch = text.match(/PRODUCT_URL:\s*(\S+)/i);
  const noteMatch = text.match(/NOTE:\s*(.+)/i);

  const colesPrice = colesMatch && colesMatch[1].toLowerCase() !== "null" ? parseFloat(colesMatch[1]) : null;
  // Extra guard beyond the prompt instruction: only accept something that's
  // actually shaped like a real Coles product URL, in case the model
  // reports "null" with different casing/punctuation or something else
  // that isn't a URL at all - never pass through a malformed/hallucinated
  // link just because a line happened to be present.
  const rawUrl = urlMatch ? urlMatch[1].replace(/[.,;)]+$/, "") : null;
  const productUrl = rawUrl && /^https:\/\/www\.coles\.com\.au\/product\//.test(rawUrl) ? rawUrl : null;
  const note = noteMatch && noteMatch[1].trim().toLowerCase() !== "null" ? noteMatch[1].trim() : null;

  return { colesPrice, productUrl, note };
}

async function checkPrice(itemName: string): Promise<CheckPriceResult> {
  const client = await getAnthropicClient();
  const response = await client.messages.create(
    {
      model: "claude-haiku-4-5",
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      tools: [
        { type: "web_search_20250305", name: "web_search", max_uses: 4 },
        { type: "web_fetch_20250910", name: "web_fetch", max_uses: 4 },
      ],
      messages: [{ role: "user", content: `What's the current price of "${itemName}" at Coles in Australia?` }],
    },
    { timeout: 30_000 }
  );

  const text = response.content
    .filter((b): b is Extract<(typeof response.content)[number], { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  return parseResult(text);
}

// A tracked target can come from either list - trackPrice is independently
// toggleable on inventory items and shopping list entries (see
// ShoppingListEntry.trackPrice's schema comment), and both get checked the
// same way and written back through their own list's setter.
interface TrackedTarget {
  id: string;
  name: string;
  apply: (price: LastKnownPrice) => Promise<void>;
}

// Triggered daily by an EventBridge Scheduler schedule (see
// infra/lib/pantry-stack.ts), and on-demand via the "sync prices now"
// settings button - a best-effort background refresh, not a data path
// anything else depends on, so a failure on one item just leaves its
// lastKnownPrice stale rather than anything user-visible breaking.
export async function checkTrackedPrices(): Promise<void> {
  const [items, shoppingList] = await Promise.all([getAllItems(), getShoppingList()]);

  const targets: TrackedTarget[] = [
    ...items
      .filter((i) => i.trackPrice)
      .map((i): TrackedTarget => ({ id: i.id, name: i.name, apply: (price) => setLastKnownPrice(i.id, price) })),
    ...shoppingList
      .filter((e) => e.trackPrice)
      .map(
        (e): TrackedTarget => ({
          id: e.id,
          name: e.name,
          apply: (price) => setShoppingListLastKnownPrice(e.id, price),
        })
      ),
  ].slice(0, MAX_ITEMS_PER_RUN);

  if (targets.length === 0) {
    console.log("No trackPrice items - skipping price check.");
    return;
  }

  for (const target of targets) {
    try {
      const result = await checkPrice(target.name);
      const price: LastKnownPrice = { ...result, checkedAt: new Date().toISOString() };
      await target.apply(price);
      console.log(`Checked "${target.name}": Coles $${price.colesPrice ?? "?"}${price.note ? ` (${price.note})` : ""}`);
    } catch (err) {
      console.error(`Price check failed for "${target.name}":`, err);
    }
  }
}
