import { CloudWatchClient, GetMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME } from "./ddb";

const cloudwatch = new CloudWatchClient({});

const OPERATION_PREFIX = "OP#";

export interface OperationStats {
  name: string;
  count: number;
  avgDurationMs: number;
}

export interface HourlyCount {
  timestamp: string;
  count: number;
}

export interface SystemStats {
  requestsLast24h: number;
  avgDurationMs: number;
  errorsLast24h: number;
  aiQueriesTotal: number;
  operations: OperationStats[];
  operationsLast3Days: OperationStats[];
  requestsByHour: HourlyCount[];
}

interface LambdaMetrics {
  requests: number;
  avgDuration: number;
  errors: number;
  requestsByHour: HourlyCount[];
}

const METRICS_CACHE_TTL_MS = 60_000;
// Module-scope cache reused across invocations on a warm Lambda container, so
// concurrent page loads share one CloudWatch call instead of one each --
// CloudWatch metrics only update on their own ~1 minute cadence anyway.
let metricsCache: { functionName: string; data: LambdaMetrics; expiresAt: number } | null = null;

async function getLambdaMetrics(functionName: string): Promise<LambdaMetrics> {
  if (metricsCache && metricsCache.functionName === functionName && metricsCache.expiresAt > Date.now()) {
    return metricsCache.data;
  }

  const data = await fetchLambdaMetrics(functionName);
  metricsCache = { functionName, data, expiresAt: Date.now() + METRICS_CACHE_TTL_MS };
  return data;
}

async function fetchLambdaMetrics(functionName: string): Promise<LambdaMetrics> {
  const end = new Date();
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  const dimensions = [{ Name: "FunctionName", Value: functionName }];

  const res = await cloudwatch.send(
    new GetMetricDataCommand({
      StartTime: start,
      EndTime: end,
      ScanBy: "TimestampAscending",
      MetricDataQueries: [
        {
          Id: "requests",
          MetricStat: {
            Metric: { Namespace: "AWS/Lambda", MetricName: "Invocations", Dimensions: dimensions },
            Period: 86400,
            Stat: "Sum",
          },
        },
        {
          Id: "duration",
          MetricStat: {
            Metric: { Namespace: "AWS/Lambda", MetricName: "Duration", Dimensions: dimensions },
            Period: 86400,
            Stat: "Average",
          },
        },
        {
          Id: "errors",
          MetricStat: {
            Metric: { Namespace: "AWS/Lambda", MetricName: "Errors", Dimensions: dimensions },
            Period: 86400,
            Stat: "Sum",
          },
        },
        {
          Id: "requestsByHour",
          MetricStat: {
            Metric: { Namespace: "AWS/Lambda", MetricName: "Invocations", Dimensions: dimensions },
            Period: 3600,
            Stat: "Sum",
          },
        },
      ],
    })
  );

  const result = (id: string) => res.MetricDataResults?.find((r) => r.Id === id);
  const valueFor = (id: string) => result(id)?.Values?.[0] ?? 0;

  const hourly = result("requestsByHour");
  const requestsByHour: HourlyCount[] = (hourly?.Timestamps ?? []).map((timestamp, i) => ({
    timestamp: timestamp.toISOString(),
    count: Math.round(hourly?.Values?.[i] ?? 0),
  }));

  return {
    requests: valueFor("requests"),
    avgDuration: valueFor("duration"),
    errors: valueFor("errors"),
    requestsByHour,
  };
}

async function getAiQueriesTotal(): Promise<number> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { pk: "STATS", sk: "AI_QUERIES" } })
  );
  return (res.Item?.count as number | undefined) ?? 0;
}

const MAX_OPERATIONS_SHOWN = 8;
const RECENT_DAYS = 3;

interface OperationAggregate {
  count: number;
  totalMs: number;
}

function finalizeAggregate(agg: Map<string, OperationAggregate>): OperationStats[] {
  return Array.from(agg.entries())
    .map(([name, { count, totalMs }]) => ({
      name,
      count,
      avgDurationMs: count > 0 ? Math.round((totalMs / count) * 10) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_OPERATIONS_SHOWN);
}

// Reads day-bucketed items (sk = "OP#<name>#<YYYY-MM-DD>") and aggregates
// them two ways: across everything still in the table (bounded by the
// plugin's TTL, so "all time" really means "last RETENTION_DAYS days"), and
// across just the last few days for a view of current activity. Both are
// capped to the top N by count, since AI-generated queries can mint a new
// name every time and the table places no limit on how many accumulate.
async function getOperationStats(): Promise<{ allTime: OperationStats[]; recent: OperationStats[] }> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":pk": "STATS", ":prefix": OPERATION_PREFIX },
    })
  );

  const recentDayKeys = new Set<string>();
  for (let i = 0; i < RECENT_DAYS; i++) {
    recentDayKeys.add(new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  }

  const allTimeAgg = new Map<string, OperationAggregate>();
  const recentAgg = new Map<string, OperationAggregate>();

  for (const item of res.Items ?? []) {
    const withoutPrefix = (item.sk as string).slice(OPERATION_PREFIX.length);
    const separatorIndex = withoutPrefix.lastIndexOf("#");
    const name = separatorIndex >= 0 ? withoutPrefix.slice(0, separatorIndex) : withoutPrefix;
    const day = separatorIndex >= 0 ? withoutPrefix.slice(separatorIndex + 1) : "";
    const count = (item.count as number | undefined) ?? 0;
    const totalMs = (item.totalMs as number | undefined) ?? 0;

    const allEntry = allTimeAgg.get(name) ?? { count: 0, totalMs: 0 };
    allEntry.count += count;
    allEntry.totalMs += totalMs;
    allTimeAgg.set(name, allEntry);

    if (recentDayKeys.has(day)) {
      const recentEntry = recentAgg.get(name) ?? { count: 0, totalMs: 0 };
      recentEntry.count += count;
      recentEntry.totalMs += totalMs;
      recentAgg.set(name, recentEntry);
    }
  }

  return { allTime: finalizeAggregate(allTimeAgg), recent: finalizeAggregate(recentAgg) };
}

export async function getSystemStats(functionName: string | undefined): Promise<SystemStats> {
  const [metrics, aiQueriesTotal, operationStats] = await Promise.all([
    functionName
      ? getLambdaMetrics(functionName)
      : Promise.resolve({ requests: 0, avgDuration: 0, errors: 0, requestsByHour: [] }),
    getAiQueriesTotal(),
    getOperationStats(),
  ]);

  return {
    requestsLast24h: Math.round(metrics.requests),
    avgDurationMs: Math.round(metrics.avgDuration * 10) / 10,
    errorsLast24h: Math.round(metrics.errors),
    aiQueriesTotal,
    operations: operationStats.allTime,
    operationsLast3Days: operationStats.recent,
    requestsByHour: metrics.requestsByHour,
  };
}
