import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import * as AWSXRay from "aws-xray-sdk-core";
import type Anthropic from "@anthropic-ai/sdk";
import { typeDefs } from "../../schema";
import { getAnthropicClient } from "@shared/anthropic-client";
import { assertNotRateLimited } from "../util/rate-limit";
import { ddb, TABLE_NAME } from "../aws/ddb";

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

export interface GenerateQueryResult {
  query: string | null;
  message: string | null;
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

export async function generateQuery(prompt: string, sourceIp?: string): Promise<GenerateQueryResult> {
  const trimmed = prompt.trim();
  if (!trimmed) throw new Error("prompt is required.");
  if (trimmed.length > MAX_PROMPT_LENGTH) {
    throw new Error(`Keep the prompt under ${MAX_PROMPT_LENGTH} characters.`);
  }

  await assertNotRateLimited(sourceIp);

  const client = await getAnthropicClient();

  // Not an AWS SDK call, so X-Ray can't auto-instrument it - wrap it in its
  // own subsegment so the trace breakdown shows how much of the latency is
  // actually Anthropic vs. our own code.
  const response = process.env.AWS_LAMBDA_FUNCTION_NAME
    ? await AWSXRay.captureAsyncFunc("Anthropic API", async (subsegment) => {
        try {
          const res = await callAnthropic(client, trimmed);
          subsegment?.close();
          return res;
        } catch (err) {
          subsegment?.close(err instanceof Error ? err : undefined);
          throw err;
        }
      })
    : await callAnthropic(client, trimmed);

  const parsed = response.parsed_output as GenerateQueryResult | null;
  if (!parsed) throw new Error("Claude didn't return a valid response - try rephrasing.");

  await recordAiQueryServed(sourceIp);

  return parsed;
}
