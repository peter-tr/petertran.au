// Shared by check-prices.ts and parse-command.ts - both call claude-haiku-4-5
// and both want to surface the same cost/duration/tool-use shape to the
// frontend's nerd-mode display (see schema.graphql's AiCallDebugInfo).
export interface AiCallDebugInfo {
  costUsd: number;
  durationMs: number;
  searchesUsed: number;
  fetchesUsed: number;
}

// claude-haiku-4-5 pricing: $1/MTok input, $5/MTok output (see the skill's
// pricing table) - an estimate for display only, not a billed amount.
const HAIKU_INPUT_USD_PER_TOKEN = 1 / 1_000_000;
const HAIKU_OUTPUT_USD_PER_TOKEN = 5 / 1_000_000;

interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  server_tool_use?: {
    web_search_requests?: number | null;
    web_fetch_requests?: number | null;
  } | null;
}

export function buildDebugInfo(usage: UsageLike, durationMs: number): AiCallDebugInfo {
  return {
    costUsd:
      usage.input_tokens * HAIKU_INPUT_USD_PER_TOKEN + usage.output_tokens * HAIKU_OUTPUT_USD_PER_TOKEN,
    durationMs,
    searchesUsed: usage.server_tool_use?.web_search_requests ?? 0,
    fetchesUsed: usage.server_tool_use?.web_fetch_requests ?? 0,
  };
}
