import { getAnthropicClient } from "@shared/anthropic-client";
import { getAllItems, setLastKnownPrice, type LastKnownPrice } from "../../services/inventory";
import { getShoppingList, setShoppingListLastKnownPrice } from "../../services/shopping-list";
import { startPriceSync, recordPriceCheckProgress, finishPriceSync } from "../../services/price-sync-status";
import { buildDebugInfo, type AiCallDebugInfo } from "./debug-info";

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
const SYSTEM_PROMPT = `You look up the current Coles price (Australia) for an item in a pantry-tracking app. The person looking at this wants a real number to glance at, even an approximate/labeled one - null is a last resort, not a safe default, and should be rare.

Rules:
- Pick ONE specific, real product at Coles that's the closest match to the item name given - the standard/most common variant if the name is generic (e.g. a regular-flavour 12-pack for a bare brand name, a standard 1kg pack for loose produce), the exact one if it's specific. A different PACK SIZE than what the name implies is still a match, not a miss - e.g. if the item is "400g chicken breast" and the closest/only product you can find and confirm is a 1kg pack, use that: report its real price and its real URL, and say in NOTE what size it actually is (e.g. "priced as the 1kg pack - no 400g size found"). Never withhold an answer just because the exact size wasn't available. PRODUCT_URL and COLES_PRICE, when both present, must be from that SAME product - never a price from one product paired with a URL you saw for a different one.
- PRODUCT_URL and COLES_PRICE are independent - finding the closest matching product (so you have a real URL for it) and confirming its current price are two different things, and Coles frequently makes the second one hard (see below) without that meaning you failed at the first. Report PRODUCT_URL for the closest matching product whenever ANY real, plausible match exists at Coles - which is true for nearly every ordinary grocery/household item - even if COLES_PRICE ends up null for it.
- Try web_fetch on that product's page to confirm its price. Coles' site sometimes blocks fetches outright (a security/access error) or requires a store location to show a "final" price - when that happens, don't give up on the price entirely: fall back to whatever price a search result showed for that same product, with a note about the location caveat. A blocked/failed fetch is never itself a reason to report null - it just means the number came from search instead of the page, which is exactly what NOTE is for.
- A confirmed exact price beats a labeled assumption, but a labeled assumption beats null - a price of null is close to useless for someone glancing at their pantry list. If a search doesn't turn up a clean match for the exact item name given, don't stop at null: search again for the item's most common/standard version and report that price, with a note explaining what you assumed (e.g. "assumed standard 12-pack - item name didn't specify a variant").
- Finding multiple brands/sizes is NOT a reason to report null for either field - pick the closest match (the cheapest, the most standard size, or whichever you can actually confirm) and note the other options in NOTE instead.
- Only report null for COLES_PRICE (and, separately, only report null for PRODUCT_URL) when you genuinely cannot find ANYTHING - no search result mentioning any price at all, or no real product at Coles that plausibly matches. If you found even one number from one source for a plausible match, report it with a caveat in NOTE rather than null. Never construct, guess, or infer a URL yourself - only report one you actually fetched or saw linked in a search result.
- Never silently substitute a different item's price without saying so - the note is what makes an assumption safe to show the user, so an assumed price without a note explaining the assumption isn't good enough.

End your response with exactly these three lines, each on its own line, using the literal word "null" (not a placeholder) only when you truly found nothing for that field. COLES_PRICE must be a single plain number with no dollar sign and no range (e.g. "7.00", never "$7.00" or "0.84-6.00"):
COLES_PRICE: <a single plain number, or null>
PRODUCT_URL: <the exact coles.com.au product page URL for the closest matching product, or null>
NOTE: <short caveat, or null>`;

// Verifying the price actually shown on the product page we're about to
// link, rather than trusting the first call's self-reported number - real
// runs showed the first call reporting a price from a search snippet (or a
// different variant/pack size) that didn't match the exact page it also
// linked, which is worse than useless once the user clicks through and
// finds a different number. This is deliberately a separate, narrowly-
// scoped call rather than folding the instruction into SYSTEM_PROMPT -
// "verify what you just found" needs its own fetch of the exact URL, not
// another round of search.
const VERIFY_SYSTEM_PROMPT = `You confirm the current price shown on a specific Coles (Australia) product page.

Fetch the URL given and report ONLY the price actually displayed on that exact page for the main product - not a per-unit/per-kg rate unless that's the only number shown, not a price from anywhere else. If the fetch is blocked, errors, or the page requires a store location before showing a price, report null - never guess or reuse a price from memory.

End your response with exactly one line:
COLES_PRICE: <a single plain number with no dollar sign, or null>`;

async function verifyPriceOnPage(productUrl: string): Promise<{ colesPrice: number | null; debugInfo: AiCallDebugInfo }> {
  const client = await getAnthropicClient();
  const startedAt = Date.now();
  const response = await client.messages.create(
    {
      model: "claude-haiku-4-5",
      max_tokens: 300,
      system: VERIFY_SYSTEM_PROMPT,
      tools: [{ type: "web_fetch_20250910", name: "web_fetch", max_uses: 2 }],
      messages: [{ role: "user", content: `Fetch ${productUrl} and report the current price shown on it.` }],
    },
    { timeout: 30_000 }
  );
  const debugInfo = buildDebugInfo(response.usage, Date.now() - startedAt);

  const text = response.content
    .filter((b): b is Extract<(typeof response.content)[number], { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const match = text.match(/COLES_PRICE:\s*(null|[\d.]+)/i);
  const colesPrice = match && match[1].toLowerCase() !== "null" ? parseFloat(match[1]) : null;

  return { colesPrice, debugInfo };
}

export interface CheckPriceResult {
  colesPrice: number | null;
  productUrl: string | null;
  note: string | null;
  debugInfo: AiCallDebugInfo;
}

function parseResult(text: string): Omit<CheckPriceResult, "debugInfo"> {
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

export async function checkPrice(itemName: string): Promise<CheckPriceResult> {
  const client = await getAnthropicClient();
  const startedAt = Date.now();
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
  const debugInfo = buildDebugInfo(response.usage, Date.now() - startedAt);

  const text = response.content
    .filter((b): b is Extract<(typeof response.content)[number], { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const result = parseResult(text);

  // Re-fetch the exact page we're about to link and use ITS price as the
  // final answer, falling back to the first call's number only if
  // verification itself couldn't get one (still better than no price at
  // all). Combine both calls' usage so nerd mode reflects the true total
  // cost/duration for this one price check, not just half of it.
  if (result.productUrl) {
    const verified = await verifyPriceOnPage(result.productUrl);
    // Falling back to the first call's number (not null) when verification
    // itself couldn't confirm one - "an unconfirmed number" beats "no
    // number", same reasoning as the rest of this prompt. Label it so the
    // client's "~" convention kicks in, rather than showing it as flatly
    // confirmed when it's really just carried over from a search result.
    const usingUnverifiedFallback = verified.colesPrice === null && result.colesPrice !== null;
    return {
      ...result,
      colesPrice: verified.colesPrice ?? result.colesPrice,
      note: usingUnverifiedFallback
        ? `${result.note ? `${result.note} - ` : ""}not independently confirmed on the product page`
        : result.note,
      debugInfo: {
        costUsd: debugInfo.costUsd + verified.debugInfo.costUsd,
        durationMs: debugInfo.durationMs + verified.debugInfo.durationMs,
        searchesUsed: debugInfo.searchesUsed + verified.debugInfo.searchesUsed,
        fetchesUsed: debugInfo.fetchesUsed + verified.debugInfo.fetchesUsed,
      },
    };
  }

  return { ...result, debugInfo };
}

// A tracked target can come from either list - trackPrice is independently
// toggleable on inventory items and shopping list entries (see
// ShoppingListEntry.trackPrice's schema comment), and both get checked the
// same way and written back through their own list's setter.
interface TrackedTarget {
  id: string;
  list: "inventory" | "shoppingList";
  name: string;
  apply: (price: LastKnownPrice) => Promise<void>;
}

export interface PriceCheckTarget {
  id: string;
  list: "inventory" | "shoppingList";
}

// Triggered daily by an EventBridge Scheduler schedule (see
// infra/lib/pantry-stack.ts), on-demand via the "sync prices now" settings
// button (checks everything tracked), and on-demand for a single item via
// `only` (checks just that one) - a best-effort background refresh, not a
// data path anything else depends on, so a failure on one item just leaves
// its lastKnownPrice stale rather than anything user-visible breaking.
export async function checkTrackedPrices(only?: PriceCheckTarget): Promise<void> {
  const [items, shoppingList] = await Promise.all([getAllItems(), getShoppingList()]);

  const allTargets: TrackedTarget[] = [
    ...items
      .filter((i) => i.trackPrice)
      .map(
        (i): TrackedTarget => ({
          id: i.id,
          list: "inventory",
          name: i.name,
          apply: (price) => setLastKnownPrice(i.id, price),
        })
      ),
    ...shoppingList
      .filter((e) => e.trackPrice)
      .map(
        (e): TrackedTarget => ({
          id: e.id,
          list: "shoppingList",
          name: e.name,
          apply: (price) => setShoppingListLastKnownPrice(e.id, price),
        })
      ),
  ];

  // A toggle-on for one specific item shouldn't re-check everything else
  // that happens to be tracked too - that's "crazy amount of calls to
  // Coles" for what should be a single lookup. Only the bulk paths (no
  // `only`) apply the run-size cap.
  const targets = only
    ? allTargets.filter((t) => t.id === only.id && t.list === only.list)
    : allTargets.slice(0, MAX_ITEMS_PER_RUN);

  if (targets.length === 0) {
    console.log("No trackPrice items - skipping price check.");
    return;
  }

  await startPriceSync(targets.length);

  for (const target of targets) {
    try {
      const result = await checkPrice(target.name);
      const price: LastKnownPrice = { ...result, checkedAt: new Date().toISOString() };
      await target.apply(price);
      console.log(`Checked "${target.name}": Coles $${price.colesPrice ?? "?"}${price.note ? ` (${price.note})` : ""}`);
      await recordPriceCheckProgress();
    } catch (err) {
      console.error(`Price check failed for "${target.name}":`, err);
      await recordPriceCheckProgress({
        itemName: target.name,
        message: err instanceof Error ? err.message : "Unknown error",
        occurredAt: new Date().toISOString(),
      });
    }
  }

  await finishPriceSync();
}
