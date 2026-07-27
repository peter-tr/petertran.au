import type Anthropic from "@anthropic-ai/sdk";
import type { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";
import { validatePortfolioQuery } from "../util/portfolio-query-allowlist";

// Enough for one query attempt plus one retry after a rejected/invalid
// query - confirmed budget, chosen to bound worst-case added latency (see
// design-studio-stack.ts's timeout comment) rather than allow open-ended
// back-and-forth.
const MAX_TOOL_ITERATIONS = 2;
const SUPERGRAPH_REQUEST_TIMEOUT_MS = 8_000;

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

async function executeSupergraphQuery(supergraphUrl: string, query: string): Promise<unknown> {
  const res = await fetch(supergraphUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(SUPERGRAPH_REQUEST_TIMEOUT_MS),
  });
  const body = (await res.json()) as { data?: unknown; errors?: unknown };

  if (!res.ok || body.errors) {
    throw new Error(JSON.stringify(body.errors ?? { status: res.status }));
  }

  return body.data;
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
  prompt: string
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
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      tools: [QUERY_PORTFOLIO_DATA_TOOL],
      // Never "any" - most prompts need no portfolio data at all, forcing a
      // call every time would waste latency/cost on the common case.
      tool_choice: { type: "auto" },
      messages,
    });

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

      const input = block.input as { query?: unknown };
      if (typeof input.query !== "string") {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: "query must be a string.",
          is_error: true,
        });
        continue;
      }

      const validation = validatePortfolioQuery(input.query);
      if (!validation.ok) {
        // Returned as a tool_result the model can react to and retry with a
        // corrected query (within the remaining budget), rather than
        // throwing and killing the whole generateDesignElements call over
        // a scoping mistake.
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Query rejected: ${validation.reason}`,
          is_error: true,
        });
        continue;
      }

      try {
        const data = await executeSupergraphQuery(supergraphUrl, input.query);
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(data) });
      } catch (err) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Query failed: ${err instanceof Error ? err.message : "unknown error"}`,
          is_error: true,
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  // Budget exhausted while still mid-tool-use - degrade to no context
  // rather than looping forever; phase 2 just runs unaugmented, same as if
  // the toggle were off.
  return null;
}
