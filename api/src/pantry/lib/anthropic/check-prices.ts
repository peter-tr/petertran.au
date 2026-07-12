import { getAnthropicClient } from "@shared/anthropic-client";
import { getAllItems, setLastKnownPrice, type LastKnownPrice } from "../../services/inventory";

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

End your response with exactly these two lines, each on its own line, using the literal word "null" (not a placeholder) when a value is unknown. COLES_PRICE must be a single plain number with no dollar sign and no range (e.g. "7.00", never "$7.00" or "0.84-6.00") - if multiple variants have different prices, pick one (the cheapest, or the most standard/common) as the number and put the others in NOTE instead:
COLES_PRICE: <a single plain number, or null>
NOTE: <short caveat, or null>`;

interface CheckPriceResult {
  colesPrice: number | null;
  note: string | null;
}

function parseResult(text: string): CheckPriceResult {
  const colesMatch = text.match(/COLES_PRICE:\s*(null|[\d.]+)/i);
  const noteMatch = text.match(/NOTE:\s*(.+)/i);

  const colesPrice = colesMatch && colesMatch[1].toLowerCase() !== "null" ? parseFloat(colesMatch[1]) : null;
  const note = noteMatch && noteMatch[1].trim().toLowerCase() !== "null" ? noteMatch[1].trim() : null;

  return { colesPrice, note };
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

// Triggered daily by an EventBridge Scheduler schedule (see
// infra/lib/pantry-stack.ts) - a best-effort background refresh, not a data
// path anything else depends on, so a failure on one item just leaves its
// lastKnownPrice stale rather than anything user-visible breaking.
export async function checkTrackedPrices(): Promise<void> {
  const items = await getAllItems();
  const tracked = items.filter((i) => i.trackPrice).slice(0, MAX_ITEMS_PER_RUN);

  if (tracked.length === 0) {
    console.log("No trackPrice items - skipping price check.");
    return;
  }

  for (const item of tracked) {
    try {
      const result = await checkPrice(item.name);
      const price: LastKnownPrice = { ...result, checkedAt: new Date().toISOString() };
      await setLastKnownPrice(item.id, price);
      console.log(`Checked "${item.name}": Coles $${price.colesPrice ?? "?"}${price.note ? ` (${price.note})` : ""}`);
    } catch (err) {
      console.error(`Price check failed for "${item.name}":`, err);
    }
  }
}
