import { CostExplorerClient, GetCostAndUsageCommand } from "@aws-sdk/client-cost-explorer";
import { captureAwsClient } from "api-shared/xray";
import { ddb, TABLE_NAME } from "./ddb";
import { CachedCostFetcher } from "./cached-cost-fetcher";

// Cost Explorer is a global service only reachable via us-east-1, regardless
// of which region the rest of the stack runs in.
const costExplorer = captureAwsClient(new CostExplorerClient({ region: "us-east-1" }));

function dateStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function fetchAwsCostUsd(start: Date, end: Date): Promise<number> {
  const res = await costExplorer.send(
    new GetCostAndUsageCommand({
      TimePeriod: { Start: dateStr(start), End: dateStr(end) },
      Granularity: "MONTHLY",
      Metrics: ["UnblendedCost"],
      // Usage-only, unblended cost: the real pre-credit dollar amount, since
      // promotional credits show up as a separate negative Credit line item
      // that would otherwise mask the actual usage cost.
      Filter: { Dimensions: { Key: "RECORD_TYPE", Values: ["Usage"] } },
    })
  );

  return (
    res.ResultsByTime?.reduce((sum, period) => sum + Number(period.Total?.UnblendedCost?.Amount ?? 0), 0) ?? 0
  );
}

class AwsCostFetcher extends CachedCostFetcher {
  constructor() {
    super({
      ddb,
      tableName: TABLE_NAME,
      cacheKey: { pk: "STATS", sk: "AWS_COST" },
      // 25h, not 6h - cost-refresh-handler.ts proactively refreshes this
      // once a day now, so this TTL is only a backstop if that schedule
      // ever misses a day (see anthropic-cost.ts's matching comment for the
      // incident that motivated this).
      cacheTtlMs: 25 * 60 * 60 * 1000,
    });
  }

  // Cost Explorer bills $0.01 per API call and only updates roughly once a
  // day, so results are cached in DynamoDB (not just in-memory) to survive
  // cold starts and keep this to a handful of real calls per day regardless
  // of traffic.
  protected async fetchRaw(now: Date): Promise<number> {
    // Cost Explorer refuses to look back more than 14 months - 12 is a safe
    // margin under that, and this project's AWS resources are all much
    // younger than that anyway, so it effectively captures the account's
    // whole history.
    const start = new Date(now.getFullYear(), now.getMonth() - 12, 1);
    // Cost Explorer's End is exclusive, so End = today would exclude
    // today's usage entirely - use tomorrow instead to include today's
    // (estimated) spend, which Cost Explorer does support returning
    // same-day.
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    return fetchAwsCostUsd(start, end);
  }

  // No fallback here - unlike Anthropic's footer figure, a failure
  // propagates so the caller sees it rather than silently showing 0.
  protected async onFetchError(err: unknown): Promise<number> {
    throw err;
  }
}

const awsCostFetcher = new AwsCostFetcher();

export async function getAwsAllTimeCostUsd(): Promise<number> {
  return awsCostFetcher.getAllTimeCostUsd();
}
