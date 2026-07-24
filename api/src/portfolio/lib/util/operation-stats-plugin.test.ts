import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("api-shared/operation-metrics", () => ({
  emitOperationCountMetric: vi.fn(),
}));

vi.mock("aws-xray-sdk-core", () => ({
  getSegment: vi.fn(),
}));

import { emitOperationCountMetric } from "api-shared/operation-metrics";
import * as AWSXRay from "aws-xray-sdk-core";
import { operationStatsPlugin } from "./operation-stats-plugin";

const ddbMock = mockClient(DynamoDBDocumentClient);

function fakeRequestContext(overrides: {
  sourceIp?: string;
  operationName?: string | null;
  operationType?: "query" | "mutation" | "subscription";
  query?: string;
  variables?: Record<string, unknown>;
}) {
  return {
    contextValue: { sourceIp: overrides.sourceIp },
    // Distinguish "not passed" (default to a name) from an explicit null
    // (the real "no operation name" case) - `??` would treat both the same.
    operationName: overrides.operationName === undefined ? "SomeOperation" : overrides.operationName,
    operation: overrides.operationType ? { operation: overrides.operationType } : undefined,
    request: { query: overrides.query, variables: overrides.variables },
  } as never;
}

async function fireWillSendResponse(overrides: Parameters<typeof fakeRequestContext>[0]) {
  const listeners = await operationStatsPlugin.requestDidStart!({} as never);
  await listeners!.willSendResponse!(fakeRequestContext(overrides));
}

describe("operationStatsPlugin", () => {
  const originalFunctionName = process.env.AWS_LAMBDA_FUNCTION_NAME;

  beforeEach(() => {
    ddbMock.reset();
    ddbMock.on(UpdateCommand).resolves({});
    vi.mocked(emitOperationCountMetric).mockReset();
    vi.mocked(AWSXRay.getSegment).mockReset();
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  });

  afterEach(() => {
    if (originalFunctionName === undefined) delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    else process.env.AWS_LAMBDA_FUNCTION_NAME = originalFunctionName;
  });

  it("records the visitor when a source IP is present", async () => {
    await fireWillSendResponse({ sourceIp: "1.2.3.4", operationType: "query" });

    const visitorCall = ddbMock
      .commandCalls(UpdateCommand)
      .find((c) => (c.args[0].input.Key as { sk: string }).sk === "VISITORS_ALL_TIME");
    expect(visitorCall).toBeDefined();
    expect(visitorCall!.args[0].input.ExpressionAttributeValues).toEqual({ ":ip": new Set(["1.2.3.4"]) });
  });

  it("skips recording a visitor when there is no source IP", async () => {
    await fireWillSendResponse({ operationType: "query" });

    const visitorCall = ddbMock
      .commandCalls(UpdateCommand)
      .find((c) => (c.args[0].input.Key as { sk: string }).sk === "VISITORS_ALL_TIME");
    expect(visitorCall).toBeUndefined();
  });

  it("always increments the total-requests counter", async () => {
    await fireWillSendResponse({ operationType: "query" });

    const totalCall = ddbMock
      .commandCalls(UpdateCommand)
      .find((c) => (c.args[0].input.Key as { sk: string }).sk === "TOTAL_REQUESTS");
    expect(totalCall).toBeDefined();
  });

  it("swallows a DynamoDB failure while recording the visitor/total-request counters", async () => {
    ddbMock.on(UpdateCommand).rejects(new Error("dynamo down"));

    await expect(
      fireWillSendResponse({ sourceIp: "1.2.3.4", operationType: "query" })
    ).resolves.toBeUndefined();
  });

  it.each(["IntrospectionQuery", "TraceBreakdown", "SystemStats"])(
    "does not emit a metric or record operation stats for the ignored operation %s",
    async (operationName) => {
      await fireWillSendResponse({ operationName, operationType: "query" });

      expect(emitOperationCountMetric).not.toHaveBeenCalled();

      const opCall = ddbMock
        .commandCalls(UpdateCommand)
        .find((c) => (c.args[0].input.Key as { sk: string }).sk.startsWith("OP#"));
      expect(opCall).toBeUndefined();
    }
  );

  it("emits a metric and records a query sample (query + variables)", async () => {
    await fireWillSendResponse({
      operationName: "Resume",
      operationType: "query",
      query: "query Resume { person { name } }",
      variables: { foo: "bar" },
    });

    expect(emitOperationCountMetric).toHaveBeenCalledWith("portfolio", "Resume", "query");

    const opCall = ddbMock
      .commandCalls(UpdateCommand)
      .find((c) => (c.args[0].input.Key as { sk: string }).sk.startsWith("OP#Resume#"));
    expect(opCall).toBeDefined();
    expect(opCall!.args[0].input.ExpressionAttributeValues?.[":lastQuery"]).toBe(
      "query Resume { person { name } }"
    );
    expect(opCall!.args[0].input.ExpressionAttributeValues?.[":lastVariables"]).toBe(
      JSON.stringify({ foo: "bar" })
    );
  });

  it("records null variables when the query has no variables", async () => {
    await fireWillSendResponse({
      operationName: "Resume",
      operationType: "query",
      query: "query Resume { person { name } }",
      variables: {},
    });

    const opCall = ddbMock
      .commandCalls(UpdateCommand)
      .find((c) => (c.args[0].input.Key as { sk: string }).sk.startsWith("OP#Resume#"));
    expect(opCall!.args[0].input.ExpressionAttributeValues?.[":lastVariables"]).toBeNull();
  });

  it("never records a query/variables sample for a mutation (privacy - contact form data)", async () => {
    await fireWillSendResponse({
      operationName: "ReachOut",
      operationType: "mutation",
      query: 'mutation ReachOut { sendMessage(input: { name: "a", email: "b", message: "c" }) { success } }',
      variables: { name: "a" },
    });

    const opCall = ddbMock
      .commandCalls(UpdateCommand)
      .find((c) => (c.args[0].input.Key as { sk: string }).sk.startsWith("OP#ReachOut#"));
    expect(opCall).toBeDefined();

    const updateExpression = opCall!.args[0].input.UpdateExpression as string;
    expect(updateExpression).not.toContain("lastQuery");
    expect(updateExpression).not.toContain("lastVariables");
  });

  it("defaults to 'Anonymous' when there is no operation name", async () => {
    await fireWillSendResponse({ operationName: null, operationType: "query" });

    expect(emitOperationCountMetric).toHaveBeenCalledWith("portfolio", "Anonymous", "query");
  });

  it("does not call getSegment (and records no trace ID) outside of Lambda", async () => {
    await fireWillSendResponse({
      operationName: "Resume",
      operationType: "query",
      query: "query Resume { x }",
    });

    expect(AWSXRay.getSegment).not.toHaveBeenCalled();

    const opCall = ddbMock
      .commandCalls(UpdateCommand)
      .find((c) => (c.args[0].input.Key as { sk: string }).sk.startsWith("OP#Resume#"));
    expect(opCall!.args[0].input.UpdateExpression).not.toContain("lastTraceId");
  });

  it("records the trace ID from a root segment when running in Lambda", async () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = "portfolio-fn";
    vi.mocked(AWSXRay.getSegment).mockReturnValue({ trace_id: "root-trace-id" } as never);

    await fireWillSendResponse({
      operationName: "Resume",
      operationType: "query",
      query: "query Resume { x }",
    });

    const opCall = ddbMock
      .commandCalls(UpdateCommand)
      .find((c) => (c.args[0].input.Key as { sk: string }).sk.startsWith("OP#Resume#"));
    expect(opCall!.args[0].input.ExpressionAttributeValues?.[":lastTraceId"]).toBe("root-trace-id");
  });

  it("hops up via .segment.trace_id when getSegment returns a subsegment", async () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = "portfolio-fn";
    vi.mocked(AWSXRay.getSegment).mockReturnValue({ segment: { trace_id: "sub-trace-id" } } as never);

    await fireWillSendResponse({
      operationName: "Resume",
      operationType: "query",
      query: "query Resume { x }",
    });

    const opCall = ddbMock
      .commandCalls(UpdateCommand)
      .find((c) => (c.args[0].input.Key as { sk: string }).sk.startsWith("OP#Resume#"));
    expect(opCall!.args[0].input.ExpressionAttributeValues?.[":lastTraceId"]).toBe("sub-trace-id");
  });
});
