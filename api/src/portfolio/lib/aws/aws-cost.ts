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
//
// Also coalesces concurrent in-flight calls: the footer queries awsCostUsd,
// anthropicCostUsd, and totalCostUsd as three sibling fields, and totalCostUsd
// itself calls this function again - without this, a single cold-cache page
// load would fire two real (paid) Cost Explorer calls back to back instead
// of one.
let inFlight: Promise<number> | null = null;

export async function getAwsAllTimeCostUsd(): Promise<number> {
  if (inFlight) return inFlight;
  inFlight = fetchAwsAllTimeCostUsd().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function fetchAwsAllTimeCostUsd(): Promise<number> {
  const cached = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: CACHE_KEY }));
  const fetchedAt = cached.Item?.fetchedAt as string | undefined;
  if (fetchedAt && Date.now() - new Date(fetchedAt).getTime() < CACHE_TTL_MS) {
    return cached.Item?.amountUsd as number;
  }

  const now = new Date();
  // Cost Explorer refuses to look back more than 14 months - 12 is a safe
  // margin under that, and this project's AWS resources are all much younger
  // than that anyway, so it effectively captures the account's whole history.
  const start = new Date(now.getFullYear(), now.getMonth() - 12, 1);
  // Cost Explorer's End is exclusive, so End = today would exclude today's
  // usage entirely - use tomorrow instead to include today's (estimated)
  // spend, which Cost Explorer does support returning same-day.
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const amountUsd = await fetchAwsCostUsd(start, end);

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
