import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type Anthropic from "@anthropic-ai/sdk";
import { typeDefs } from "../../schema";
import { getAnthropicClient } from "@shared/anthropic-client";
import { traced, ANTHROPIC_API_SEGMENT_NAME } from "@shared/xray";
import { assertNotRateLimited } from "../util/rate-limit";
import { ddb, TABLE_NAME } from "../aws/ddb";
import type { Context } from "../../context";

const MAX_PROMPT_LENGTH = 300;

const GENERATE_QUERY_SYSTEM_PROMPT = `You write GraphQL queries against this exact schema:

${typeDefs}

Rules:
- If the request is about contacting, messaging, reaching out to, or getting in
  touch with Peter, return "query" set to exactly this mutation, verbatim, with the
  string values left empty for the visitor to fill in themselves:
  mutation ReachOut {
    sendMessage(input: { name: "", email: "", message: "" }) {
      success
      message
    }
  }
  Never invent a name, email address, or message on the visitor's behalf. Set
  "message" to a short, friendly sentence telling them you've filled in the
  message form below and they should add their details and click Run to send it.
- Else if the request can be answered by querying this schema, return "query" set
  to a single valid query operation (never a mutation in this case), and "message"
  set to null.
- If the request is unrelated to this schema (e.g. general knowledge, weather,
  opinions, anything not about Peter's resume/skills/projects, or contacting him),
  return "query" set to null and "message" set to a short, friendly sentence
  explaining that you can only answer questions about the resume data in this
  schema.
- Always write the "query" keyword followed by a short PascalCase name, e.g.
  "query FunFact { ... }" - never the anonymous shorthand ("{ ... }" with no
  "query"/name), even for a single simple field.
- Only select fields and arguments that exist in the schema above.
- Do not include any explanation, commentary, or markdown code fences.`;

const ANSWER_SYSTEM_PROMPT = `You answer a visitor's question about Peter Tran using ONLY the JSON data
provided below - it's the real result of the GraphQL query written to answer
this exact question.

Rules:
- Write 1-3 short, conversational sentences, third person ("Peter has...",
  not "I have...").
- Only state facts present in the data. Never invent or infer anything not
  there - if the data doesn't actually answer the question, say so briefly.
- No markdown, no field names, no code fences - just plain prose.`;

const MUTATION_PATTERN = /^\s*mutation\b/i;

interface RawGeneratedQuery {
  query: string | null;
  message: string | null;
}

export interface GenerateQueryResult extends RawGeneratedQuery {
  answer: string | null;
}

// Best-effort usage counter for the "little dashboard" of live stats - skips
// entirely in local dev, same as rate limiting, since there's no sourceIp there.
async function recordAiQueryServed(sourceIp: string | undefined): Promise<void> {
  if (!sourceIp) return;
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk: "STATS", sk: "AI_QUERIES" },
      UpdateExpression: "ADD #count :incr",
      ExpressionAttributeNames: { "#count": "count" },
      ExpressionAttributeValues: { ":incr": 1 },
    })
  );
}

async function callAnthropic(client: Anthropic, trimmed: string) {
  return client.messages.parse({
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
}

async function callAnswerAnthropic(
  client: Anthropic,
  prompt: string,
  data: Record<string, unknown>
): Promise<string | null> {
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 200,
    system: ANSWER_SYSTEM_PROMPT,
    messages: [{ role: "user", content: `Question: ${prompt}\n\nData:\n${JSON.stringify(data)}` }],
  });
  const textBlock = response.content.find((block) => block.type === "text");

  return textBlock ? textBlock.text.trim() : null;
}

export async function generateQuery(
  prompt: string,
  sourceIp: string | undefined,
  runInternalQuery: Context["runInternalQuery"]
): Promise<GenerateQueryResult> {
  const trimmed = prompt.trim();
  if (!trimmed) throw new Error("prompt is required.");
  if (trimmed.length > MAX_PROMPT_LENGTH) {
    throw new Error(`Keep the prompt under ${MAX_PROMPT_LENGTH} characters.`);
  }

  await assertNotRateLimited(sourceIp);

  const client = await getAnthropicClient();

  const response = await traced(ANTHROPIC_API_SEGMENT_NAME, () => callAnthropic(client, trimmed));
  const parsed = response.parsed_output as RawGeneratedQuery | null;
  if (!parsed) throw new Error("Claude didn't return a valid response - try rephrasing.");

  await recordAiQueryServed(sourceIp);

  // Only a real (non-mutation) query gets a natural-language answer - a
  // mutation draft or an unanswerable prompt already has a suitable
  // `message`, and running a mutation on the visitor's behalf is never OK.
  if (!parsed.query || MUTATION_PATTERN.test(parsed.query)) {
    return { ...parsed, answer: null };
  }

  const { data, errors } = await runInternalQuery(parsed.query);
  if (errors?.length || !data) {
    // Fall back to the query/message as-is - the explorer still fills in
    // and runs the query itself, so the visitor sees the same raw
    // query/error they always would have.
    return { ...parsed, answer: null };
  }

  const answer = await traced(`${ANTHROPIC_API_SEGMENT_NAME} (answer)`, () =>
    callAnswerAnthropic(client, trimmed, data)
  );

  return { ...parsed, answer };
}
