import type { BaseContext, GraphQLRequestContext } from "@apollo/server";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOperationMetricsPlugin, emitOperationCountMetric } from "./operation-metrics";

const ddbMock = mockClient(DynamoDBDocumentClient);

function makeRequestContext(
  overrides: Partial<GraphQLRequestContext<BaseContext>> = {}
): GraphQLRequestContext<BaseContext> {
  return {
    operationName: "MyQuery",
    operation: { operation: "query" },
    ...overrides,
  } as unknown as GraphQLRequestContext<BaseContext>;
}

describe("emitOperationCountMetric", () => {
  it("logs an Embedded Metric Format line with the right namespace, dimensions, and values", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    emitOperationCountMetric("pantry", "GetInventory", "query");

    expect(logSpy).toHaveBeenCalledTimes(1);

    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);

    expect(logged._aws.CloudWatchMetrics[0].Namespace).toBe("PetertranAu/GraphQL");
    expect(logged._aws.CloudWatchMetrics[0].Dimensions).toEqual([["project"], ["project", "operationName"]]);
    expect(logged._aws.CloudWatchMetrics[0].Metrics).toEqual([{ Name: "OperationCount", Unit: "Count" }]);
    expect(logged.project).toBe("pantry");
    expect(logged.operationName).toBe("GetInventory");
    expect(logged.operationType).toBe("query");
    expect(logged.OperationCount).toBe(1);

    logSpy.mockRestore();
  });
});

describe("createOperationMetricsPlugin", () => {
  beforeEach(() => {
    ddbMock.reset();
    ddbMock.on(UpdateCommand).resolves({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function fireWillSendResponse(
    plugin: ReturnType<typeof createOperationMetricsPlugin>,
    requestContext: GraphQLRequestContext<BaseContext>
  ) {
    const listeners = await plugin.requestDidStart?.(undefined as never);
    await listeners?.willSendResponse?.(requestContext as never);
  }

  it("records an operation count row keyed by pk/skPrefix + operationName + day, and emits the CloudWatch metric", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T12:34:56.000Z"));

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const plugin = createOperationMetricsPlugin({
      project: "pantry",
      ddb: ddbMock as unknown as DynamoDBDocumentClient,
      tableName: "my-table",
      pk: "STATS",
    });

    await fireWillSendResponse(plugin, makeRequestContext({ operationName: "GetInventory" }));

    expect(logSpy).toHaveBeenCalledTimes(1);

    const calls = ddbMock.commandCalls(UpdateCommand);
    expect(calls).toHaveLength(1);

    const input = calls[0].args[0].input;
    expect(input.TableName).toBe("my-table");
    expect(input.Key).toEqual({ pk: "STATS", sk: "OP#GetInventory#2026-07-20" });
    expect(input.UpdateExpression).toBe("ADD #count :incr");
    expect(input.ExpressionAttributeValues).toEqual({ ":incr": 1 });
  });

  it("honors a custom skPrefix", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T00:00:00.000Z"));
    vi.spyOn(console, "log").mockImplementation(() => {});

    const plugin = createOperationMetricsPlugin({
      project: "imposter",
      ddb: ddbMock as unknown as DynamoDBDocumentClient,
      tableName: "my-table",
      pk: "GAME#123",
      skPrefix: "COUNT#",
    });

    await fireWillSendResponse(plugin, makeRequestContext({ operationName: "JoinGame" }));

    const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(input.Key).toEqual({ pk: "GAME#123", sk: "COUNT#JoinGame#2026-07-20" });
  });

  it("defaults to ignoring IntrospectionQuery - no DynamoDB write, no metric emitted", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const plugin = createOperationMetricsPlugin({
      project: "pantry",
      ddb: ddbMock as unknown as DynamoDBDocumentClient,
      tableName: "my-table",
      pk: "STATS",
    });

    await fireWillSendResponse(plugin, makeRequestContext({ operationName: "IntrospectionQuery" }));

    expect(logSpy).not.toHaveBeenCalled();
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it("honors a caller-supplied ignoredOperations set instead of the default", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const plugin = createOperationMetricsPlugin({
      project: "pantry",
      ddb: ddbMock as unknown as DynamoDBDocumentClient,
      tableName: "my-table",
      pk: "STATS",
      ignoredOperations: new Set(["NoisyOperation"]),
    });

    // A caller-supplied set replaces the default entirely, so IntrospectionQuery
    // is no longer ignored once the caller opts into their own list.
    await fireWillSendResponse(plugin, makeRequestContext({ operationName: "IntrospectionQuery" }));
    expect(logSpy).toHaveBeenCalledTimes(1);

    logSpy.mockClear();
    await fireWillSendResponse(plugin, makeRequestContext({ operationName: "NoisyOperation" }));
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("falls back to 'Anonymous' and 'unknown' when operationName/operation are missing", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const plugin = createOperationMetricsPlugin({
      project: "pantry",
      ddb: ddbMock as unknown as DynamoDBDocumentClient,
      tableName: "my-table",
      pk: "STATS",
    });

    await fireWillSendResponse(
      plugin,
      makeRequestContext({ operationName: undefined, operation: undefined })
    );

    expect(logSpy).toHaveBeenCalledTimes(1);

    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged.operationName).toBe("Anonymous");
    expect(logged.operationType).toBe("unknown");

    const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(input.Key?.sk).toMatch(/^OP#Anonymous#/);
  });

  it("never lets a DynamoDB write failure break the response (best-effort tracking)", async () => {
    ddbMock.on(UpdateCommand).rejects(new Error("table is on fire"));
    vi.spyOn(console, "log").mockImplementation(() => {});

    const plugin = createOperationMetricsPlugin({
      project: "pantry",
      ddb: ddbMock as unknown as DynamoDBDocumentClient,
      tableName: "my-table",
      pk: "STATS",
    });

    await expect(
      fireWillSendResponse(plugin, makeRequestContext({ operationName: "GetInventory" }))
    ).resolves.toBeUndefined();
  });
});
