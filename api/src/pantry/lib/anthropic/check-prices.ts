import { getAnthropicClient } from "@shared/anthropic-client";
import { traced } from "@shared/xray";
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
// call with no cap. max_uses + a request timeout are load-bearing, not
// optional, given that incident.
//
// Coles only, deliberately - Woolworths' pages don't reliably surface a
// price through search/fetch (confirmed live, repeatedly), and a field
// that's usually null isn't worth showing the user at all.
const BATCH_SYSTEM_PROMPT = `You look up current Coles (Australia) prices for a list of items in a pantry-tracking app, all in this one turn. The person wants a real number for every item, even an approximate/labeled one - null is a last resort, not a safe default, and should be rare.

For EACH item in the list, independently:
- Pick ONE specific, real product at Coles that's the closest match - the standard/most common variant if the name is generic (e.g. a regular-flavour 12-pack for a bare brand name, a standard 1kg pack for loose produce), the exact one if specific. A different pack size than implied is still a match, not a miss - e.g. a 1kg pack when 400g was asked for. Use it, and say what size it actually is in note.
- Find that product's page via search, then use web_fetch on the exact page to confirm its price - productUrl and colesPrice must describe the SAME product, never a price from one product paired with a URL for a different one.
- If the fetch is blocked, errors, or needs a store location selected, don't give up on the price entirely: fall back to whatever price a search result showed for that same product, noting the caveat. A blocked/failed fetch is never itself a reason to report null - it just means the number came from search instead of the page.
- Only report null for colesPrice (and, separately, only report null for productUrl) when you genuinely found NOTHING for that item - no search result mentioning any price at all, or no real product that plausibly matches. If you found even one number from one source, report it with a caveat in note instead of null.
- Never construct, guess, or infer a URL yourself - only one you actually fetched or saw linked in a search result.

Return exactly one entry per item in "results", with "name" copied EXACTLY as given in the input list (used to match results back to items) - never merge, skip, or reorder items.`;

interface BatchPriceResult {
  name: string;
  colesPrice: number | null;
  productUrl: string | null;
  note: string | null;
}

const BATCH_PRICE_CHECK_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          colesPrice: { anyOf: [{ type: "number" }, { type: "null" }] },
          productUrl: { anyOf: [{ type: "string" }, { type: "null" }] },
          note: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
        required: ["name", "colesPrice", "productUrl", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
} as const;

// One session for the whole batch, not one call per item - the system
// prompt/tool setup only gets paid for once regardless of how many items
// are in the list. Deliberate trade-off vs the old per-item design: a
// single failure (timeout, credit exhaustion, malformed output) can now
// lose the WHOLE batch's results instead of just one item, and there's no
// way to report real-time "N of M done" progress mid-call - only a jump
// from 0 to (attempted) at the very end. Tool budget/timeout/max_tokens all
// scale with batch size so a bigger tracked list doesn't silently starve
// itself of search/fetch calls or get cut off mid-response.
async function checkPricesBatch(
  names: string[]
): Promise<{ results: Map<string, BatchPriceResult>; debugInfo: AiCallDebugInfo }> {
  const client = await getAnthropicClient();
  const startedAt = Date.now();

  // Anthropic has no literal "$ ceiling" on a single call - these three
  // (tool-use count, output tokens, wall-clock timeout) are the actual
  // available levers, same as before, just re-tuned tighter now that one
  // call covers a whole batch instead of one item. Deliberately modest per-
  // item budget (not "however much it takes to fully verify everything") -
  // a hard absolute ceiling regardless of how large the tracked list gets,
  // given how easily an unbounded version of this already burned real
  // credit once (see this file's MAX_ITEMS_PER_RUN comment).
  const toolBudget = Math.min(names.length * 3, 30);
  const timeoutMs = Math.min(30_000 + names.length * 15_000, 300_000);
  const maxTokens = Math.min(400 + names.length * 200, 4096);

  const response = await traced("Anthropic API", () =>
    client.messages.parse(
      {
        model: "claude-haiku-4-5",
        max_tokens: maxTokens,
        system: BATCH_SYSTEM_PROMPT,
        tools: [
          { type: "web_search_20250305", name: "web_search", max_uses: toolBudget },
          { type: "web_fetch_20250910", name: "web_fetch", max_uses: toolBudget },
        ],
        messages: [
          {
            role: "user",
            content: `Look up the current Coles price for each of these items:\n${names.map((n) => `- ${n}`).join("\n")}`,
          },
        ],
        output_config: { format: { type: "json_schema", schema: BATCH_PRICE_CHECK_SCHEMA } },
      },
      { timeout: timeoutMs }
    )
  );

  const debugInfo = buildDebugInfo(response.usage, Date.now() - startedAt);
  const parsed = response.parsed_output as { results: BatchPriceResult[] } | null;

  const results = new Map<string, BatchPriceResult>();
  for (const r of parsed?.results ?? []) {
    // Same URL validation as before - never pass through a malformed/
    // hallucinated link just because a field happened to be present.
    const rawUrl = r.productUrl?.replace(/[.,;)]+$/, "") ?? null;
    const productUrl = rawUrl && /^https:\/\/www\.coles\.com\.au\/product\//.test(rawUrl) ? rawUrl : null;
    results.set(r.name, { ...r, productUrl });
  }

  return { results, debugInfo };
}

export interface CheckPriceResult {
  colesPrice: number | null;
  productUrl: string | null;
  note: string | null;
  debugInfo: AiCallDebugInfo;
}

// Single-item convenience wrapper around the batch call - used by
// checkPriceNow (the command bar's "want me to check now?" offer, and the
// Settings page's per-item interactions), which only ever wants one item
// checked interactively. Deliberately just a batch of one rather than a
// separate prompt/schema to maintain - same rules, same verification-via-
// fetch behavior, one prompt to keep in sync instead of two.
export async function checkPrice(itemName: string): Promise<CheckPriceResult> {
  const { results, debugInfo } = await checkPricesBatch([itemName]);
  const entry = results.get(itemName);
  return {
    colesPrice: entry?.colesPrice ?? null,
    productUrl: entry?.productUrl ?? null,
    note: entry?.note ?? null,
    debugInfo,
  };
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

// Triggered only by the "sync prices now" settings button - no automatic
// schedule and no per-item auto-trigger (both removed after a real credit-
// exhaustion incident) - a best-effort background refresh, not a data path
// anything else depends on, so a failure just leaves lastKnownPrice stale
// rather than anything user-visible breaking.
export async function checkTrackedPrices(): Promise<void> {
  const [items, shoppingList] = await Promise.all([getAllItems(), getShoppingList()]);

  const targets: TrackedTarget[] = [
    ...items
      .filter((i) => i.trackPrice)
      .map((i): TrackedTarget => ({
        id: i.id,
        list: "inventory",
        name: i.name,
        apply: (price) => setLastKnownPrice(i.id, price),
      })),
    ...shoppingList
      .filter((e) => e.trackPrice)
      .map((e): TrackedTarget => ({
        id: e.id,
        list: "shoppingList",
        name: e.name,
        apply: (price) => setShoppingListLastKnownPrice(e.id, price),
      })),
  ].slice(0, MAX_ITEMS_PER_RUN);

  if (targets.length === 0) {
    console.log("No trackPrice items - skipping price check.");
    return;
  }

  await startPriceSync(targets.length);

  let batch: { results: Map<string, BatchPriceResult>; debugInfo: AiCallDebugInfo } | null = null;
  let batchError: string | null = null;
  try {
    batch = await checkPricesBatch(targets.map((t) => t.name));
  } catch (err) {
    batchError = err instanceof Error ? err.message : "Unknown error";
    console.error("Batch price check failed entirely:", err);
  }

  // The batch's real cost/duration is shared across every item in it, not
  // a distinct call each - split evenly so nerd mode shows a fair per-item
  // share instead of the whole batch's total repeated on every row (which
  // would look like N times the real spend if someone eyeballed a few rows
  // and added them up). searchesUsed/fetchesUsed are GraphQL Ints, so this
  // rounds rather than leaving a fraction.
  const perItemDebugInfo: AiCallDebugInfo | null = batch
    ? {
        costUsd: batch.debugInfo.costUsd / targets.length,
        durationMs: Math.round(batch.debugInfo.durationMs / targets.length),
        searchesUsed: Math.round(batch.debugInfo.searchesUsed / targets.length),
        fetchesUsed: Math.round(batch.debugInfo.fetchesUsed / targets.length),
      }
    : null;

  for (const target of targets) {
    if (batchError) {
      await recordPriceCheckProgress({
        itemName: target.name,
        message: batchError,
        occurredAt: new Date().toISOString(),
      });
      continue;
    }

    const entry = batch!.results.get(target.name);
    if (!entry) {
      const message = "No result returned for this item in the batch response.";
      console.error(`Price check missing for "${target.name}"`);
      await recordPriceCheckProgress({
        itemName: target.name,
        message,
        occurredAt: new Date().toISOString(),
      });
      continue;
    }

    try {
      const price: LastKnownPrice = {
        colesPrice: entry.colesPrice,
        productUrl: entry.productUrl,
        note: entry.note,
        checkedAt: new Date().toISOString(),
        debugInfo: perItemDebugInfo!,
      };
      await target.apply(price);
      console.log(
        `Checked "${target.name}": Coles $${price.colesPrice ?? "?"}${price.note ? ` (${price.note})` : ""}`
      );
      await recordPriceCheckProgress();
    } catch (err) {
      console.error(`Failed to save price for "${target.name}":`, err);
      await recordPriceCheckProgress({
        itemName: target.name,
        message: err instanceof Error ? err.message : "Unknown error",
        occurredAt: new Date().toISOString(),
      });
    }
  }

  await finishPriceSync();
}
