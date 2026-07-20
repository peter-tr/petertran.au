import { CostExplorerClient, GetCostAndUsageCommand } from "@aws-sdk/client-cost-explorer";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TABLE_NAME } from "./ddb";

// aws-sdk-client-mock patches the client class prototype, so it intercepts
// calls made through the real singleton clients created inside aws-cost.ts
// and ddb.ts without needing to mock those modules.
const costExplorerMock = mockClient(CostExplorerClient);
const ddbMock = mockClient(DynamoDBDocumentClient);

// aws-cost.ts's `awsCostFetcher` is a module-level singleton, so re-import
// fresh each test (vi.resetModules) to avoid one test's cache state leaking
// into the next via that singleton's private fields.
async function importGetAwsAllTimeCostUsd() {
  const mod = await import("./aws-cost");

  return mod.getAwsAllTimeCostUsd;
}

describe("getAwsAllTimeCostUsd", () => {
  beforeEach(() => {
    vi.resetModules();
    costExplorerMock.reset();
    ddbMock.reset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the cached amount without calling Cost Explorer when the cache is fresh (<6h)", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { amountUsd: 17.25, fetchedAt: "2026-06-15T10:00:00.000Z" }, // 2h ago, TTL is 6h
    });

    const getAwsAllTimeCostUsd = await importGetAwsAllTimeCostUsd();

    const result = await getAwsAllTimeCostUsd();

    expect(result).toBe(17.25);
    expect(costExplorerMock.calls()).toHaveLength(0);
  });

  it("fetches from Cost Explorer and sums UnblendedCost across all periods when the cache is stale", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { amountUsd: 1, fetchedAt: "2026-06-15T00:00:00.000Z" }, // 12h ago, past the 6h TTL
    });
    ddbMock.on(PutCommand).resolves({});
    costExplorerMock.on(GetCostAndUsageCommand).resolves({
      ResultsByTime: [
        { Total: { UnblendedCost: { Amount: "10.50" } } },
        { Total: { UnblendedCost: { Amount: "5.25" } } },
        { Total: {} }, // missing Amount defaults to 0
      ],
    });

    const getAwsAllTimeCostUsd = await importGetAwsAllTimeCostUsd();

    const result = await getAwsAllTimeCostUsd();

    expect(result).toBe(15.75);
  });

  it("requests a ~12 month lookback ending tomorrow, filtered to Usage-only unblended cost", async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    ddbMock.on(PutCommand).resolves({});
    costExplorerMock.on(GetCostAndUsageCommand).resolves({ ResultsByTime: [] });

    const getAwsAllTimeCostUsd = await importGetAwsAllTimeCostUsd();

    await getAwsAllTimeCostUsd();

    expect(costExplorerMock.calls()).toHaveLength(1);

    const input = costExplorerMock.call(0).args[0].input as GetCostAndUsageCommand["input"];
    expect(input.TimePeriod).toEqual({ Start: "2025-06-01", End: "2026-06-16" });
    expect(input.Granularity).toBe("MONTHLY");
    expect(input.Metrics).toEqual(["UnblendedCost"]);
    expect(input.Filter).toEqual({ Dimensions: { Key: "RECORD_TYPE", Values: ["Usage"] } });
  });

  it("returns the cached amount without calling Cost Explorer when another container already claimed the refresh", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { amountUsd: 3, fetchedAt: "2026-06-15T00:00:00.000Z" },
    });
    ddbMock
      .on(PutCommand)
      .rejects(new ConditionalCheckFailedException({ message: "lost the race", $metadata: {} }));

    const getAwsAllTimeCostUsd = await importGetAwsAllTimeCostUsd();

    const result = await getAwsAllTimeCostUsd();

    expect(result).toBe(3);
    expect(costExplorerMock.calls()).toHaveLength(0);
  });

  it("propagates a Cost Explorer failure instead of silently returning 0", async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    ddbMock.on(PutCommand).resolves({});
    costExplorerMock.on(GetCostAndUsageCommand).rejects(new Error("Cost Explorer is down"));

    const getAwsAllTimeCostUsd = await importGetAwsAllTimeCostUsd();

    await expect(getAwsAllTimeCostUsd()).rejects.toThrow("Cost Explorer is down");
  });

  it("writes the fetched amount back to the cache under the AWS_COST key", async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    ddbMock.on(PutCommand).resolves({});
    costExplorerMock.on(GetCostAndUsageCommand).resolves({
      ResultsByTime: [{ Total: { UnblendedCost: { Amount: "20" } } }],
    });

    const getAwsAllTimeCostUsd = await importGetAwsAllTimeCostUsd();

    await getAwsAllTimeCostUsd();

    const putCalls = ddbMock.commandCalls(PutCommand);
    const storeCall = putCalls[putCalls.length - 1].args[0].input as PutCommand["input"];
    expect(storeCall.TableName).toBe(TABLE_NAME);
    expect(storeCall.Item).toMatchObject({ pk: "STATS", sk: "AWS_COST", amountUsd: 20 });
  });
});
