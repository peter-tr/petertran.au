import { CloudWatchClient, GetMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSystemStats } from "./system-stats";

const cloudwatchMock = mockClient(CloudWatchClient);
const ddbMock = mockClient(DynamoDBDocumentClient);

function opItem(
  name: string,
  day: string,
  count: number,
  totalMs: number,
  extra: Record<string, unknown> = {}
) {
  return { pk: "STATS", sk: `OP#${name}#${day}`, count, totalMs, ...extra };
}

describe("getSystemStats", () => {
  beforeEach(() => {
    cloudwatchMock.reset();
    ddbMock.reset();
    ddbMock.on(GetCommand, { Key: { pk: "STATS", sk: "AI_QUERIES" } }).resolves({ Item: undefined });
    ddbMock.on(GetCommand, { Key: { pk: "STATS", sk: "TOTAL_REQUESTS" } }).resolves({ Item: undefined });
    ddbMock.on(GetCommand, { Key: { pk: "STATS", sk: "VISITORS_ALL_TIME" } }).resolves({ Item: undefined });
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips the CloudWatch call and returns zeroed metrics when there is no function name", async () => {
    const stats = await getSystemStats(undefined);

    expect(cloudwatchMock.calls()).toHaveLength(0);
    expect(stats.avgDurationMs).toBe(0);
    expect(stats.requestsByDay).toEqual([]);
  });

  it("fetches Lambda metrics (avg duration, requests by day) when a function name is given", async () => {
    cloudwatchMock.on(GetMetricDataCommand).resolves({
      MetricDataResults: [
        {
          Id: "duration",
          Timestamps: [new Date("2026-06-13T00:00:00.000Z"), new Date("2026-06-14T00:00:00.000Z")],
          Values: [120.4, 88.6],
        },
        {
          Id: "requestsByDay",
          Timestamps: [new Date("2026-06-13T00:00:00.000Z"), new Date("2026-06-14T00:00:00.000Z")],
          Values: [3, 5.4],
        },
      ],
    });

    const stats = await getSystemStats("my-fn");

    // Most recent day's average duration, not an average across the window.
    expect(stats.avgDurationMs).toBe(88.6);
    expect(stats.requestsByDay).toEqual([
      { timestamp: "2026-06-13T00:00:00.000Z", count: 3 },
      { timestamp: "2026-06-14T00:00:00.000Z", count: 5 }, // rounded
    ]);
  });

  it("caches Lambda metrics for a minute so a second call for the same function skips CloudWatch", async () => {
    cloudwatchMock.on(GetMetricDataCommand).resolves({ MetricDataResults: [] });

    await getSystemStats("cached-fn");
    await getSystemStats("cached-fn");

    expect(cloudwatchMock.calls()).toHaveLength(1);
  });

  it("refetches Lambda metrics once the 60s cache has expired", async () => {
    cloudwatchMock.on(GetMetricDataCommand).resolves({ MetricDataResults: [] });

    await getSystemStats("expiring-fn");
    vi.advanceTimersByTime(61_000);
    await getSystemStats("expiring-fn");

    expect(cloudwatchMock.calls()).toHaveLength(2);
  });

  it("does not share the metrics cache across different function names", async () => {
    cloudwatchMock.on(GetMetricDataCommand).resolves({ MetricDataResults: [] });

    await getSystemStats("fn-a");
    await getSystemStats("fn-b");

    expect(cloudwatchMock.calls()).toHaveLength(2);
  });

  it("defaults aiQueriesTotal/requestsTotal/uniqueVisitorsTotal to 0 when no items exist", async () => {
    const stats = await getSystemStats(undefined);

    expect(stats.aiQueriesTotal).toBe(0);
    expect(stats.requestsTotal).toBe(0);
    expect(stats.uniqueVisitorsTotal).toBe(0);
  });

  it("reads aiQueriesTotal/requestsTotal counts and the unique visitor set size", async () => {
    ddbMock.on(GetCommand, { Key: { pk: "STATS", sk: "AI_QUERIES" } }).resolves({ Item: { count: 42 } });
    ddbMock
      .on(GetCommand, { Key: { pk: "STATS", sk: "TOTAL_REQUESTS" } })
      .resolves({ Item: { count: 1000 } });
    ddbMock
      .on(GetCommand, { Key: { pk: "STATS", sk: "VISITORS_ALL_TIME" } })
      .resolves({ Item: { ips: new Set(["1.1.1.1", "2.2.2.2", "3.3.3.3"]) } });

    const stats = await getSystemStats(undefined);

    expect(stats.aiQueriesTotal).toBe(42);
    expect(stats.requestsTotal).toBe(1000);
    expect(stats.uniqueVisitorsTotal).toBe(3);
  });

  it("aggregates operation stats across day buckets and sorts by count descending", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        opItem("Resume", "2026-06-01", 10, 1000),
        opItem("Resume", "2026-06-02", 5, 600),
        opItem("Skills", "2026-06-01", 20, 2000),
      ],
    });

    const stats = await getSystemStats(undefined);

    expect(stats.operations.map((o) => o.name)).toEqual(["Skills", "Resume"]);

    const resume = stats.operations.find((o) => o.name === "Resume")!;
    expect(resume.count).toBe(15);
    expect(resume.avgDurationMs).toBe(Math.round(((1000 + 600) / 15) * 10) / 10);
  });

  it("caps operations at the top 8 by count", async () => {
    const items = Array.from({ length: 12 }, (_, i) => opItem(`Op${i}`, "2026-06-01", 12 - i, 100));
    ddbMock.on(QueryCommand).resolves({ Items: items });

    const stats = await getSystemStats(undefined);

    expect(stats.operations).toHaveLength(8);
    expect(stats.operations[0].name).toBe("Op0"); // highest count (12)
  });

  it("splits operationsLast30Days from the true all-time total using day-bucket keys", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        opItem("Resume", "2026-06-14", 3, 300), // within last 30 days
        opItem("Resume", "2020-01-01", 7, 700), // long past, all-time only
      ],
    });

    const stats = await getSystemStats(undefined);

    const allTime = stats.operations.find((o) => o.name === "Resume")!;
    const recent = stats.operationsLast30Days.find((o) => o.name === "Resume")!;
    expect(allTime.count).toBe(10);
    expect(recent.count).toBe(3);
  });

  it("keeps the most recent query/variables/traceId sample across an operation's buckets", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        opItem("Resume", "2026-06-01", 1, 100, {
          lastQuery: "query Old { x }",
          lastVariables: null,
          lastTraceId: "trace-old",
        }),
        opItem("Resume", "2026-06-10", 1, 100, {
          lastQuery: "query New { y }",
          lastVariables: JSON.stringify({ a: 1 }),
          lastTraceId: "trace-new",
        }),
      ],
    });

    const stats = await getSystemStats(undefined);

    const resume = stats.operations.find((o) => o.name === "Resume")!;
    expect(resume.lastQuery).toBe("query New { y }");
    expect(resume.lastVariables).toBe(JSON.stringify({ a: 1 }));
    expect(resume.lastTraceId).toBe("trace-new");
  });

  it("parses the operation name out of sk values that themselves contain '#'", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [opItem("AI-Generated#Weird", "2026-06-01", 1, 50)],
    });

    const stats = await getSystemStats(undefined);

    expect(stats.operations[0].name).toBe("AI-Generated#Weird");
  });
});
