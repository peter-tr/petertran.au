import { CloudWatchClient, GetMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME } from "./ddb";

const cloudwatch = new CloudWatchClient({});

const OPERATION_PREFIX = "OP#";

export interface OperationStats {
  name: string;
  count: number;
  avgDurationMs: number;
  lastQuery: string | null;
  lastVariables: string | null;
  lastTraceId: string | null;
}

export interface DailyCount {
  timestamp: string;
  count: number;
}

export interface SystemStats {
  requestsTotal: number;
  avgDurationMs: number;
  aiQueriesTotal: number;
  operations: OperationStats[];
  operationsLastDay: OperationStats[];
  operationsLast7Days: OperationStats[];
  requestsByDay: DailyCount[];
  uniqueVisitorsTotal: number;
}

interface LambdaMetrics {
  avgDuration: number;
  requestsByDay: DailyCount[];
}

const METRICS_CACHE_TTL_MS = 60_000;
// Module-scope cache reused across invocations on a warm Lambda container, so
// concurrent page loads share one CloudWatch call instead of one each --
// CloudWatch metrics only update on their own ~1 minute cadence anyway.
let metricsCache: { functionName: string; data: LambdaMetrics; expiresAt: number } | null = null;

async function getLambdaMetrics(functionName: string): Promise<LambdaMetrics> {
  if (metricsCache?.functionName === functionName && metricsCache.expiresAt > Date.now()) {
    return metricsCache.data;
  }

  const data = await fetchLambdaMetrics(functionName);
  metricsCache = { functionName, data, expiresAt: Date.now() + METRICS_CACHE_TTL_MS };

  return data;
}

// CloudWatch only retains metric data for 15 months regardless of
// resolution, so a window this wide already covers true "all time" for any
// realistic lifetime of this Lambda - the frontend slices the single
// returned array down to last-1-day/last-7-days/all-time itself.
const CHART_WINDOW_DAYS = 400;

async function fetchLambdaMetrics(functionName: string): Promise<LambdaMetrics> {
  const end = new Date();
  // One shared time range for both queries below (GetMetricData applies
  // StartTime/EndTime to the whole call, not per-query) - daily buckets
  // rather than hourly, since a low-traffic personal site's real hourly
  // counts are almost all zero.
  const start = new Date(end.getTime() - CHART_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const dimensions = [{ Name: "FunctionName", Value: functionName }];

  const res = await cloudwatch.send(
    new GetMetricDataCommand({
      StartTime: start,
      EndTime: end,
      ScanBy: "TimestampAscending",
      MetricDataQueries: [
        {
          Id: "duration",
          MetricStat: {
            Metric: { Namespace: "AWS/Lambda", MetricName: "Duration", Dimensions: dimensions },
            Period: 86400,
            Stat: "Average",
          },
        },
        {
          Id: "requestsByDay",
          MetricStat: {
            Metric: { Namespace: "AWS/Lambda", MetricName: "Invocations", Dimensions: dimensions },
            Period: 86400,
            Stat: "Sum",
          },
        },
      ],
    })
  );

  const result = (id: string) => res.MetricDataResults?.find((r) => r.Id === id);

  const daily = result("requestsByDay");
  const requestsByDay: DailyCount[] = (daily?.Timestamps ?? []).map((timestamp, i) => ({
    timestamp: timestamp.toISOString(),
    count: Math.round(daily?.Values?.[i] ?? 0),
  }));

  // Most recent day's average duration, rather than a single bucket spanning
  // the whole window - the duration query shares the same 30-day range as
  // requestsByDay above, so its values are also one-per-day.
  const durationValues = result("duration")?.Values ?? [];
  const avgDuration = durationValues.length > 0 ? durationValues[durationValues.length - 1] : 0;

  return { avgDuration, requestsByDay };
}

async function getAiQueriesTotal(): Promise<number> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { pk: "STATS", sk: "AI_QUERIES" } })
  );

  return (res.Item?.count as number | undefined) ?? 0;
}

// A single running counter (see operation-stats-plugin.ts), never bucketed
// or expired, so this is a true lifetime total rather than a window that
// resets to a small (or zero) number on a low-traffic site.
async function getTotalRequests(): Promise<number> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { pk: "STATS", sk: "TOTAL_REQUESTS" } })
  );

  return (res.Item?.count as number | undefined) ?? 0;
}

// One item holding every source IP ever seen, in a single DynamoDB String
// Set (deduped by ADD at write time, see operation-stats-plugin.ts) -- a
// real all-time unique-visitor count with no cookies or client-side ID, and
// no reset window.
async function getUniqueVisitorsTotal(): Promise<number> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { pk: "STATS", sk: "VISITORS_ALL_TIME" } })
  );
  const ips = (res.Item?.ips as Set<string> | string[] | undefined) ?? [];

  return [...ips].length;
}

const MAX_OPERATIONS_SHOWN = 8;

// Sets of UTC calendar-day keys ("YYYY-MM-DD") going back `days` days from
// today (inclusive), used to bucket each window below.
function dayKeys(days: number): Set<string> {
  const keys = new Set<string>();
  for (let i = 0; i < days; i++) {
    keys.add(new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  }

  return keys;
}

interface OperationAggregate {
  count: number;
  totalMs: number;
  latestSampleDay: string | null;
  lastQuery: string | null;
  lastVariables: string | null;
  lastTraceId: string | null;
}

function newAggregate(): OperationAggregate {
  return {
    count: 0,
    totalMs: 0,
    latestSampleDay: null,
    lastQuery: null,
    lastVariables: null,
    lastTraceId: null,
  };
}

function finalizeAggregate(agg: Map<string, OperationAggregate>): OperationStats[] {
  return Array.from(agg.entries())
    .map(([name, { count, totalMs, lastQuery, lastVariables, lastTraceId }]) => ({
      name,
      count,
      avgDurationMs: count > 0 ? Math.round((totalMs / count) * 10) / 10 : 0,
      lastQuery,
      lastVariables,
      lastTraceId,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_OPERATIONS_SHOWN);
}

// Reads day-bucketed items (sk = "OP#<name>#<YYYY-MM-DD>", kept forever - see
// the plugin) and aggregates them three ways: across everything ever
// recorded (true all time), across just the last day, and across just the
// last 7 days. All three are capped to the top N by count, since
// AI-generated queries can mint a new name every time and the table places
// no limit on how many accumulate. Each bucket may also carry a sample of
// the last query it saw (queries only -- see the plugin for why mutations
// are excluded); we surface the single most recent sample across all of an
// operation's buckets.
async function getOperationStats(): Promise<{
  allTime: OperationStats[];
  lastDay: OperationStats[];
  last7Days: OperationStats[];
}> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":pk": "STATS", ":prefix": OPERATION_PREFIX },
    })
  );

  const lastDayKeys = dayKeys(1);
  const last7DaysKeys = dayKeys(7);

  const allTimeAgg = new Map<string, OperationAggregate>();
  const lastDayAgg = new Map<string, OperationAggregate>();
  const last7DaysAgg = new Map<string, OperationAggregate>();

  // One bucket-row's worth of fields to fold into an aggregate - bundled
  // into a single object (rather than 7 separate applyTo parameters) to
  // stay under SonarQube's 7-parameter limit (S107).
  interface OperationSample {
    name: string;
    day: string;
    count: number;
    totalMs: number;
    lastQuery: string | null;
    lastVariables: string | null;
    lastTraceId: string | null;
  }

  const applyTo = (map: Map<string, OperationAggregate>, sample: OperationSample) => {
    const entry = map.get(sample.name) ?? newAggregate();
    entry.count += sample.count;
    entry.totalMs += sample.totalMs;
    if (sample.lastQuery && (!entry.latestSampleDay || sample.day > entry.latestSampleDay)) {
      entry.latestSampleDay = sample.day;
      entry.lastQuery = sample.lastQuery;
      entry.lastVariables = sample.lastVariables;
      entry.lastTraceId = sample.lastTraceId;
    }
    map.set(sample.name, entry);
  };

  for (const item of res.Items ?? []) {
    const withoutPrefix = (item.sk as string).slice(OPERATION_PREFIX.length);
    const separatorIndex = withoutPrefix.lastIndexOf("#");
    const sample: OperationSample = {
      name: separatorIndex >= 0 ? withoutPrefix.slice(0, separatorIndex) : withoutPrefix,
      day: separatorIndex >= 0 ? withoutPrefix.slice(separatorIndex + 1) : "",
      count: (item.count as number | undefined) ?? 0,
      totalMs: (item.totalMs as number | undefined) ?? 0,
      lastQuery: (item.lastQuery as string | undefined) ?? null,
      lastVariables: (item.lastVariables as string | null | undefined) ?? null,
      lastTraceId: (item.lastTraceId as string | undefined) ?? null,
    };

    applyTo(allTimeAgg, sample);
    if (lastDayKeys.has(sample.day)) applyTo(lastDayAgg, sample);
    if (last7DaysKeys.has(sample.day)) applyTo(last7DaysAgg, sample);
  }

  return {
    allTime: finalizeAggregate(allTimeAgg),
    lastDay: finalizeAggregate(lastDayAgg),
    last7Days: finalizeAggregate(last7DaysAgg),
  };
}

export async function getSystemStats(functionName: string | undefined): Promise<SystemStats> {
  const [metrics, aiQueriesTotal, operationStats, requestsTotal, uniqueVisitorsTotal] = await Promise.all([
    functionName ? getLambdaMetrics(functionName) : Promise.resolve({ avgDuration: 0, requestsByDay: [] }),
    getAiQueriesTotal(),
    getOperationStats(),
    getTotalRequests(),
    getUniqueVisitorsTotal(),
  ]);

  return {
    requestsTotal,
    avgDurationMs: Math.round(metrics.avgDuration * 10) / 10,
    aiQueriesTotal,
    uniqueVisitorsTotal,
    operations: operationStats.allTime,
    operationsLastDay: operationStats.lastDay,
    operationsLast7Days: operationStats.last7Days,
    requestsByDay: metrics.requestsByDay,
  };
}
