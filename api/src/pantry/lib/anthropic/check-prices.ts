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
const SYSTEM_PROMPT = `You look up current Australian grocery prices for a pantry-tracking app.

Rules:
- Only search Coles prices. Do NOT attempt to look up Woolworths prices via search or fetch - their site loads prices dynamically and neither search snippets nor page fetches reliably surface a number, so trying wastes searches. Leave the Woolworths price null and say so in your note; never guess or copy the Coles price onto Woolworths as if it were confirmed there too.
- For items sold in variable denominations (loose produce priced per kg vs per each vs per bunch, or multiple pack sizes), report the most common/representative one as the price and name any other denominations you found in the note, rather than silently picking one with no explanation.
- Never state a price unless a search or fetch result actually confirms it for that specific product. Say null instead of guessing or inferring from a similar item.

End your response with exactly these three lines, each on its own line, using the literal word "null" (not a placeholder) when a value is unknown:
COLES_PRICE: <number or null>
WOOLWORTHS_PRICE: <number or null>
NOTE: <short caveat, or null>`;

interface CheckPriceResult {
  colesPrice: number | null;
  woolworthsPrice: number | null;
  note: string | null;
}

function parseResult(text: string): CheckPriceResult {
  const colesMatch = text.match(/COLES_PRICE:\s*(null|[\d.]+)/i);
  const woolworthsMatch = text.match(/WOOLWORTHS_PRICE:\s*(null|[\d.]+)/i);
  const noteMatch = text.match(/NOTE:\s*(.+)/i);

  const colesPrice = colesMatch && colesMatch[1].toLowerCase() !== "null" ? parseFloat(colesMatch[1]) : null;
  const woolworthsPrice =
    woolworthsMatch && woolworthsMatch[1].toLowerCase() !== "null" ? parseFloat(woolworthsMatch[1]) : null;
  const note = noteMatch && noteMatch[1].trim().toLowerCase() !== "null" ? noteMatch[1].trim() : null;

  return { colesPrice, woolworthsPrice, note };
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
      console.log(
        `Checked "${item.name}": Coles $${price.colesPrice ?? "?"}, Woolworths $${price.woolworthsPrice ?? "?"}${price.note ? ` (${price.note})` : ""}`
      );
    } catch (err) {
      console.error(`Price check failed for "${item.name}":`, err);
    }
  }
}
