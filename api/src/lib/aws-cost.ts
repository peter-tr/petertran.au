import { CostExplorerClient, GetCostAndUsageCommand } from "@aws-sdk/client-cost-explorer";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME } from "./ddb";

// Cost Explorer is a global service only reachable via us-east-1, regardless
// of which region the rest of the stack runs in.
const costExplorer = new CostExplorerClient({ region: "us-east-1" });

const CACHE_KEY = { pk: "STATS", sk: "AWS_COST" };
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const RETENTION_DAYS = 30;

function dateStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Cost Explorer bills $0.01 per API call and only updates roughly once a day,
// so results are cached in DynamoDB (not just in-memory) to survive cold
// starts and keep this to a handful of real calls per day regardless of
// traffic.
export async function getAwsCostThisMonthUsd(): Promise<number> {
  const cached = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: CACHE_KEY }));
  const fetchedAt = cached.Item?.fetchedAt as string | undefined;
  if (fetchedAt && Date.now() - new Date(fetchedAt).getTime() < CACHE_TTL_MS) {
    return cached.Item?.amountUsd as number;
  }

  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  // Cost Explorer's End is exclusive, so on the first day of the month there's
  // no completed day to report yet - avoid calling with Start === End.
  const amountUsd = start >= now ? 0 : await fetchAwsCostThisMonthUsd(start, now);

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        ...CACHE_KEY,
        amountUsd,
        fetchedAt: now.toISOString(),
        ttl: Math.floor(Date.now() / 1000) + RETENTION_DAYS * 24 * 60 * 60,
      },
    })
  );

  return amountUsd;
}

async function fetchAwsCostThisMonthUsd(start: Date, end: Date): Promise<number> {
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
