import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../../context";

vi.mock("../util/rate-limit", () => ({
  assertNotRateLimited: vi.fn(),
}));

vi.mock("api-shared/anthropic-client", () => ({
  getAnthropicClient: vi.fn(),
}));

vi.mock("api-shared/xray", () => ({
  ANTHROPIC_API_SEGMENT_NAME: "Anthropic API",
  traced: vi.fn((_name: string, fn: () => Promise<unknown>) => fn()),
  // ddb.ts (transitively imported via "../aws/ddb") also pulls captureAwsClient
  // from this module, so the mock factory needs to provide it too.
  captureAwsClient: vi.fn((client: unknown) => client),
}));

import { assertNotRateLimited } from "../util/rate-limit";
import { getAnthropicClient } from "api-shared/anthropic-client";
import { traced } from "api-shared/xray";
import { generateQuery } from "./generate-query";

const ddbMock = mockClient(DynamoDBDocumentClient);

function makeAnthropicClient(parsedOutput: unknown, answerText: string | null = "Some answer.") {
  return {
    messages: {
      parse: vi.fn().mockResolvedValue({ parsed_output: parsedOutput }),
      create: vi.fn().mockResolvedValue({
        content: answerText === null ? [] : [{ type: "text", text: answerText }],
      }),
    },
  };
}

describe("generateQuery", () => {
  const runInternalQuery = vi.fn<Context["runInternalQuery"]>();
  const xraySegment = undefined;

  beforeEach(() => {
    ddbMock.reset();
    ddbMock.on(UpdateCommand).resolves({});
    vi.mocked(assertNotRateLimited).mockReset().mockResolvedValue(undefined);
    runInternalQuery.mockReset();
  });

  afterEach(() => {
    vi.mocked(traced).mockClear();
  });

  it("throws when the prompt is empty or whitespace-only", async () => {
    await expect(generateQuery("   ", "1.2.3.4", runInternalQuery, xraySegment)).rejects.toThrow(
      "prompt is required."
    );
    expect(assertNotRateLimited).not.toHaveBeenCalled();
  });

  it("throws when the prompt exceeds the max length", async () => {
    const tooLong = "a".repeat(301);
    await expect(generateQuery(tooLong, "1.2.3.4", runInternalQuery, xraySegment)).rejects.toThrow(
      "Keep the prompt under 300 characters."
    );
  });

  it("propagates the rate limit error and never calls Anthropic", async () => {
    vi.mocked(assertNotRateLimited).mockRejectedValue(new Error("Too many requests"));

    const client = makeAnthropicClient({ query: null, message: "hi" });
    vi.mocked(getAnthropicClient).mockResolvedValue(client as never);

    await expect(generateQuery("hello", "1.2.3.4", runInternalQuery, xraySegment)).rejects.toThrow(
      "Too many requests"
    );
    expect(client.messages.parse).not.toHaveBeenCalled();
  });

  it("throws a friendly error when Claude returns no parsed output", async () => {
    const client = makeAnthropicClient(null);
    vi.mocked(getAnthropicClient).mockResolvedValue(client as never);

    await expect(generateQuery("hello", "1.2.3.4", runInternalQuery, xraySegment)).rejects.toThrow(
      "Claude didn't return a valid response - try rephrasing."
    );
  });

  it("records AI query usage when a source IP is present", async () => {
    const client = makeAnthropicClient({ query: null, message: "Ask me about the resume." });
    vi.mocked(getAnthropicClient).mockResolvedValue(client as never);

    await generateQuery("what's the weather", "1.2.3.4", runInternalQuery, xraySegment);

    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    expect(updateCalls).toHaveLength(1);
    expect((updateCalls[0].args[0].input.Key as { sk: string }).sk).toBe("AI_QUERIES");
  });

  it("does not record AI query usage when there is no source IP (local dev)", async () => {
    const client = makeAnthropicClient({ query: null, message: "hi" });
    vi.mocked(getAnthropicClient).mockResolvedValue(client as never);

    await generateQuery("hello", undefined, runInternalQuery, xraySegment);

    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it("returns answer: null for the ReachOut mutation draft, without running it", async () => {
    const client = makeAnthropicClient({
      query:
        'mutation ReachOut {\n  sendMessage(input: { name: "", email: "", message: "" }) { success message }\n}',
      message: "I've filled in the form below.",
    });
    vi.mocked(getAnthropicClient).mockResolvedValue(client as never);

    const result = await generateQuery("I want to contact Peter", "1.2.3.4", runInternalQuery, xraySegment);

    expect(result.answer).toBeNull();
    expect(runInternalQuery).not.toHaveBeenCalled();
  });

  it("returns answer: null when query is null (unrelated/unanswerable prompt)", async () => {
    const client = makeAnthropicClient({ query: null, message: "I can only answer resume questions." });
    vi.mocked(getAnthropicClient).mockResolvedValue(client as never);

    const result = await generateQuery("what's the weather", "1.2.3.4", runInternalQuery, xraySegment);

    expect(result).toEqual({
      query: null,
      message: "I can only answer resume questions.",
      answer: null,
    });
    expect(runInternalQuery).not.toHaveBeenCalled();
  });

  it("runs the generated query and falls back to answer: null when it errors", async () => {
    const client = makeAnthropicClient({ query: "query FunFact { person { name } }", message: null });
    vi.mocked(getAnthropicClient).mockResolvedValue(client as never);
    runInternalQuery.mockResolvedValue({ data: null, errors: ["boom"] });

    const result = await generateQuery("what's his name", "1.2.3.4", runInternalQuery, xraySegment);

    expect(runInternalQuery).toHaveBeenCalledWith("query FunFact { person { name } }");
    expect(result.answer).toBeNull();
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it("runs the generated query and falls back to answer: null when there is no data", async () => {
    const client = makeAnthropicClient({ query: "query FunFact { person { name } }", message: null });
    vi.mocked(getAnthropicClient).mockResolvedValue(client as never);
    runInternalQuery.mockResolvedValue({ data: null });

    const result = await generateQuery("what's his name", "1.2.3.4", runInternalQuery, xraySegment);

    expect(result.answer).toBeNull();
  });

  it("answers in natural language when the query runs successfully", async () => {
    const client = makeAnthropicClient(
      { query: "query FunFact { person { name } }", message: null },
      "Peter's name is Ada."
    );
    vi.mocked(getAnthropicClient).mockResolvedValue(client as never);
    runInternalQuery.mockResolvedValue({ data: { person: { name: "Ada" } } });

    const result = await generateQuery("what's his name", "1.2.3.4", runInternalQuery, xraySegment);

    expect(result).toEqual({
      query: "query FunFact { person { name } }",
      message: null,
      answer: "Peter's name is Ada.",
    });
    expect(client.messages.create).toHaveBeenCalledOnce();
    expect(traced).toHaveBeenCalledWith("Anthropic API (answer)", expect.any(Function), xraySegment);
  });

  it("traces the initial generation call with the shared Anthropic segment name", async () => {
    const client = makeAnthropicClient({ query: null, message: "hi" });
    vi.mocked(getAnthropicClient).mockResolvedValue(client as never);

    await generateQuery("hello", "1.2.3.4", runInternalQuery, xraySegment);

    expect(traced).toHaveBeenCalledWith("Anthropic API", expect.any(Function), xraySegment);
  });

  it("returns null answer when the answer response has no text block", async () => {
    const client = makeAnthropicClient({ query: "query FunFact { person { name } }", message: null }, null);
    vi.mocked(getAnthropicClient).mockResolvedValue(client as never);
    runInternalQuery.mockResolvedValue({ data: { person: { name: "Ada" } } });

    const result = await generateQuery("what's his name", "1.2.3.4", runInternalQuery, xraySegment);

    expect(result.answer).toBeNull();
  });
});
