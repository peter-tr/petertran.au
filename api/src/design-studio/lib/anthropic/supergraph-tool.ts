import type Anthropic from "@anthropic-ai/sdk";
import type { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";
import { validatePortfolioQuery } from "../util/portfolio-query-allowlist";

// Enough for one query attempt plus one retry after a rejected/invalid
// query - confirmed budget, chosen to bound worst-case added latency (see
// design-studio-stack.ts's timeout comment) rather than allow open-ended
// back-and-forth.
const MAX_TOOL_ITERATIONS = 2;
const SUPERGRAPH_REQUEST_TIMEOUT_MS = 8_000;
// Below this, don't even start another iteration - a Claude call given less
// than this is more likely to be cut off mid-request (wasted latency, no
// usable result) than to finish something useful in time.
const MIN_TOOL_CALL_TIMEOUT_MS = 3_000;

const QUERY_PORTFOLIO_DATA_TOOL: Anthropic.Tool = {
  name: "query_portfolio_data",
  description:
    "Query real portfolio/resume content (person, education, experience, projects, skills, programs, interests) from petertran.au's public GraphQL API, to ground design generation in facts - e.g. a resume header using the person's actual name/role, or a project-showcase slide using real project names. Read-only: only \"query\" operations selecting these fields are accepted, anything else is rejected. Only call this when the prompt would clearly benefit from real portfolio data; most prompts (a generic poster, an abstract theme) need nothing from here - just skip the tool and reply that no data is needed.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          'A complete GraphQL query document selecting only from person, education, experience, projects, skills, programs, interests - e.g. "{ person { name location } experience(currentOnly: true) { role company } }".',
      },
    },
    required: ["query"],
  },
};

async function executeSupergraphQuery(
  supergraphUrl: string,
  query: string,
  timeoutMs: number
): Promise<unknown> {
  const res = await fetch(supergraphUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Router reads this by default (see web/src/shared/graphqlClient.ts's
      // identical comment) to attribute traffic to a named client in GraphOS
      // Studio - without it this server-to-server call showed up as
      // "Unidentified client". Distinct from the browser-originated
      // "design-studio" client name (real user traffic) since this is the
      // AI tool's own portfolio-data lookup, not something a user's browser
      // ever sends directly.
      "apollographql-client-name": "design-studio-ai-tool",
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = (await res.json()) as { data?: unknown; errors?: unknown };

  if (!res.ok || body.errors) {
    throw new Error(JSON.stringify(body.errors ?? { status: res.status }));
  }

  return body.data;
}

// Resolves a single tool_use block into its tool_result - pulled out of
// gatherSupergraphContext's loop so the input-shape check, the
// allowlist-validation rejection, and the query-execution try/catch (three
// independent failure modes, each returning its own tool_result rather than
// throwing) don't all nest inside that function's own iteration/budget
// control flow.
async function resolveToolUseBlock(
  block: Anthropic.ToolUseBlock,
  supergraphUrl: string,
  deadlineAt: number
): Promise<Anthropic.ToolResultBlockParam> {
  const input = block.input as { query?: unknown };
  if (typeof input.query !== "string") {
    return { type: "tool_result", tool_use_id: block.id, content: "query must be a string.", is_error: true };
  }

  const validation = validatePortfolioQuery(input.query);
  if (!validation.ok) {
    // Returned as a tool_result the model can react to and retry with a
    // corrected query (within the remaining budget), rather than throwing
    // and killing the whole generateDesignElements call over a scoping
    // mistake.
    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: `Query rejected: ${validation.reason}`,
      is_error: true,
    };
  }

  try {
    const fetchTimeoutMs = Math.max(0, Math.min(SUPERGRAPH_REQUEST_TIMEOUT_MS, deadlineAt - Date.now()));
    const data = await executeSupergraphQuery(supergraphUrl, input.query, fetchTimeoutMs);

    return { type: "tool_result", tool_use_id: block.id, content: JSON.stringify(data) };
  } catch (err) {
    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: `Query failed: ${err instanceof Error ? err.message : "unknown error"}`,
      is_error: true,
    };
  }
}

// "Phase 1" of generateDesignElements - a short, bounded tool_use loop that
// lets Claude decide whether real portfolio data would help this prompt,
// run before (and separate from) the existing structured-output ("phase 2")
// call. Kept as a distinct plain messages.create loop rather than folding
// into the phase-2 call, since mixing custom tool_use with
// output_config.format: json_schema in one call isn't something this repo
// has precedent for and would couple two independent concerns together.
// Works unmodified against either client getAiClient can return - both the
// direct Anthropic SDK and AnthropicBedrock expose the identical
// messages.create(params, options) shape.
export async function gatherSupergraphContext(
  client: Anthropic | AnthropicBedrock,
  model: string,
  prompt: string,
  // Absolute deadline (Date.now()-comparable), not a duration - generate-
  // elements.ts shares one deadline across this phase-1 loop and its own
  // phase-2 call, so however long this loop actually takes, phase 2 gets
  // whatever's genuinely left rather than each phase assuming it owns the
  // full budget independently. Without this, neither the Claude tool_use
  // calls below nor executeSupergraphQuery's fetch had any bound tighter
  // than the Lambda's own timeout - a slow/hanging call here (observed live
  // against Bedrock) could silently run the request out past API Gateway's
  // 29s ceiling with zero warning, since a caught error here just degrades
  // to "no context" rather than surfacing anything.
  deadlineAt: number
): Promise<string | null> {
  const supergraphUrl = process.env.SUPERGRAPH_URL;
  if (!supergraphUrl) return null;

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `A user asked a design-generation AI for: "${prompt}". Decide whether real portfolio data would improve the result. If so, call query_portfolio_data once. If not, just reply with a short sentence saying no data is needed.`,
    },
  ];

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const remainingMs = deadlineAt - Date.now();
    // Not enough of the budget left to reasonably expect this call to
    // finish - degrade to no context now rather than starting (and likely
    // wasting) another round-trip.
    if (remainingMs < MIN_TOOL_CALL_TIMEOUT_MS) return null;

    const response = await client.messages.create(
      {
        model,
        max_tokens: 1024,
        tools: [QUERY_PORTFOLIO_DATA_TOOL],
        // Never "any" - most prompts need no portfolio data at all, forcing a
        // call every time would waste latency/cost on the common case.
        tool_choice: { type: "auto" },
        messages,
      },
      { timeout: remainingMs }
    );

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();

      return text || null;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      toolResults.push(await resolveToolUseBlock(block, supergraphUrl, deadlineAt));
    }

    messages.push({ role: "user", content: toolResults });
  }

  // Budget exhausted while still mid-tool-use - degrade to no context
  // rather than looping forever; phase 2 just runs unaugmented, same as if
  // the toggle were off.
  return null;
}
