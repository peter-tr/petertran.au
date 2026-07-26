import type { AiModelTier } from "api-shared/ai-provider";

// Shared by check-prices.ts and parse-command.ts - both want to surface the
// same cost/duration/tool-use shape to the frontend's nerd-mode display (see
// schema.graphql's AiCallDebugInfo). check-prices.ts is pinned to HAIKU (see
// its own file), parse-command.ts's tier varies with PantrySettings.aiModelTier.
export interface AiCallDebugInfo {
  costUsd: number;
  durationMs: number;
  searchesUsed: number;
  fetchesUsed: number;
}

// Per-MTok USD, direct Anthropic API rates (see the skill's pricing table) -
// used for both providers since Bedrock pricing tracks the direct API price
// for these models. An estimate for display only, not a billed amount.
const PRICING_USD_PER_TOKEN: Record<AiModelTier, { input: number; output: number }> = {
  HAIKU: { input: 1 / 1_000_000, output: 5 / 1_000_000 },
  SONNET: { input: 3 / 1_000_000, output: 15 / 1_000_000 },
};

interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  server_tool_use?: {
    web_search_requests?: number | null;
    web_fetch_requests?: number | null;
  } | null;
}

export function buildDebugInfo(
  usage: UsageLike,
  durationMs: number,
  modelTier: AiModelTier
): AiCallDebugInfo {
  const pricing = PRICING_USD_PER_TOKEN[modelTier];

  return {
    costUsd: usage.input_tokens * pricing.input + usage.output_tokens * pricing.output,
    durationMs,
    searchesUsed: usage.server_tool_use?.web_search_requests ?? 0,
    fetchesUsed: usage.server_tool_use?.web_fetch_requests ?? 0,
  };
}
