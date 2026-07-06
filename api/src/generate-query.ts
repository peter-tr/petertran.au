import { typeDefs } from "./schema.js";
import { getAnthropicClient } from "./anthropic-client.js";
import { assertNotRateLimited } from "./rate-limit.js";

const MAX_PROMPT_LENGTH = 300;

const GENERATE_QUERY_SYSTEM_PROMPT = `You write GraphQL queries against this exact schema:

${typeDefs}

Rules:
- If the request can be answered by querying this schema, return "query" set to a
  single valid query operation (never a mutation, even if asked), and "message" set
  to null.
- If the request is unrelated to this schema (e.g. general knowledge, weather,
  opinions, anything not about Peter's resume/skills/projects), return "query" set
  to null and "message" set to a short, friendly sentence explaining that you can
  only answer questions about the resume data in this schema.
- Name generated operations with a short PascalCase name.
- Only select fields and arguments that exist in the schema above.
- Do not include any explanation, commentary, or markdown code fences.`;

export interface GenerateQueryResult {
  query: string | null;
  message: string | null;
}

export async function generateQuery(prompt: string, sourceIp?: string): Promise<GenerateQueryResult> {
  const trimmed = prompt.trim();
  if (!trimmed) throw new Error("prompt is required.");
  if (trimmed.length > MAX_PROMPT_LENGTH) {
    throw new Error(`Keep the prompt under ${MAX_PROMPT_LENGTH} characters.`);
  }

  await assertNotRateLimited(sourceIp);

  const client = await getAnthropicClient();

  const response = await client.messages.parse({
    model: "claude-haiku-4-5",
    max_tokens: 512,
    system: GENERATE_QUERY_SYSTEM_PROMPT,
    messages: [{ role: "user", content: trimmed }],
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            query: { anyOf: [{ type: "string" }, { type: "null" }] },
            message: { anyOf: [{ type: "string" }, { type: "null" }] },
          },
          required: ["query", "message"],
          additionalProperties: false,
        },
      },
    },
  });

  const parsed = response.parsed_output as GenerateQueryResult | null;
  if (!parsed) throw new Error("Claude didn't return a valid response -- try rephrasing.");

  return parsed;
}
