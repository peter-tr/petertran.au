import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { ddb, TABLE_NAME } from "../aws/ddb";

let cachedAdminApiKey: string | null = null;

// Mirrors anthropic-client.ts's pattern: a plain env var for local dev,
// Secrets Manager (by ARN) in deployed environments. Cached at module scope
// so a warm Lambda container only fetches the secret once.
async function getAnthropicAdminApiKey(): Promise<string | null> {
  if (cachedAdminApiKey) return cachedAdminApiKey;
  if (process.env.ANTHROPIC_ADMIN_API_KEY) {
    cachedAdminApiKey = process.env.ANTHROPIC_ADMIN_API_KEY;

    return cachedAdminApiKey;
  }

  const secretArn = process.env.ANTHROPIC_ADMIN_SECRET_ARN;
  if (!secretArn) return null;

  const client = new SecretsManagerClient({});
  const res = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (!res.SecretString) return null;

  cachedAdminApiKey = res.SecretString;

  return cachedAdminApiKey;
}

interface CostReportResult {
  amount: string;
}

interface CostReportBucket {
  results: CostReportResult[];
}

interface CostReportResponse {
  data: CostReportBucket[];
  has_more: boolean;
  next_page: string | null;
}

const CACHE_KEY = { pk: "STATS", sk: "ANTHROPIC_COST" };
// Anthropic's cost data lands within ~5 minutes of a request completing
// (much fresher than AWS Cost Explorer's ~daily cadence), so a shorter
// cache window is worthwhile here.
const CACHE_TTL_MS = 60 * 60 * 1000;
const RETENTION_DAYS = 30;

// Requires an Admin API key (separate from the messages-API key used
// elsewhere) - returns 0 rather than failing if it's not configured, since
// this is a nice-to-have footer figure, not core functionality.
//
// Also coalesces concurrent in-flight calls: the footer queries awsCostUsd,
// anthropicCostUsd, and totalCostUsd as three sibling fields, and totalCostUsd
// itself calls this function again - without this, a single cold-cache page
// load would fire the whole ~12-request paginated fetch twice back to back.
let inFlight: Promise<number> | null = null;

export async function getAnthropicAllTimeCostUsd(): Promise<number> {
  if (inFlight) return inFlight;
  inFlight = fetchAnthropicAllTimeCostUsd().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

async function fetchAnthropicAllTimeCostUsd(): Promise<number> {
  const apiKey = await getAnthropicAdminApiKey();
  if (!apiKey) return 0;

  const cached = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: CACHE_KEY }));
  const fetchedAt = cached.Item?.fetchedAt as string | undefined;
  const cachedAmountUsd = cached.Item?.amountUsd as number | undefined;
  if (fetchedAt && Date.now() - new Date(fetchedAt).getTime() < CACHE_TTL_MS) {
    return cachedAmountUsd ?? 0;
  }

  const now = new Date();

  // Claim the refresh with a conditional write before doing the real
  // (paginated) fetch below. Without this, several concurrent Lambda
  // containers racing past an expired cache would each independently see it
  // as stale and fire their own paginated fetch - the condition only lets
  // the container that read the cache first "win"; the rest fall back to
  // the last cached amount instead of double-fetching.
  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          ...CACHE_KEY,
          amountUsd: cachedAmountUsd ?? 0,
          fetchedAt: now.toISOString(),
          ttl: Math.floor(Date.now() / 1000) + RETENTION_DAYS * 24 * 60 * 60,
        },
        ConditionExpression: fetchedAt ? "fetchedAt = :prevFetchedAt" : "attribute_not_exists(fetchedAt)",
        ExpressionAttributeValues: fetchedAt ? { ":prevFetchedAt": fetchedAt } : undefined,
      })
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return cachedAmountUsd ?? 0;
    }
    throw err;
  }

  // 12 months back comfortably covers this project's whole history (and
  // matches the same lookback used for the AWS side); the cost endpoint
  // caps at 31 daily buckets per page, so a range this wide means fetchCost
  // below paginates through roughly a dozen requests.
  const startingAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12, 1));
  const endingAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  let amountUsd: number;
  try {
    amountUsd = await fetchAnthropicCostUsd(apiKey, startingAt, endingAt);
  } catch (err) {
    console.error("Failed to fetch Anthropic cost report:", err);
    // Release the claim (restore the pre-claim fetchedAt, or clear it if this
    // was the first-ever fetch) so a still-stale cache keeps retrying on the
    // next request instead of sitting "fresh" for a full hour after a failure.
    await ddb
      .send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            ...CACHE_KEY,
            amountUsd: cachedAmountUsd ?? 0,
            ...(fetchedAt ? { fetchedAt } : {}),
            ttl: Math.floor(Date.now() / 1000) + RETENTION_DAYS * 24 * 60 * 60,
          },
        })
      )
      .catch(() => {});

    return cachedAmountUsd ?? 0;
  }

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

async function fetchAnthropicCostUsd(apiKey: string, startingAt: Date, endingAt: Date): Promise<number> {
  let totalCents = 0;
  let page: string | undefined;

  do {
    const params = new URLSearchParams({
      starting_at: startingAt.toISOString(),
      ending_at: endingAt.toISOString(),
      limit: "31",
    });
    if (page) params.set("page", page);

    const res = await fetch(`https://api.anthropic.com/v1/organizations/cost_report?${params}`, {
      headers: {
        "anthropic-version": "2023-06-01",
        "x-api-key": apiKey,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Anthropic cost_report returned ${res.status}`);

    const body = (await res.json()) as CostReportResponse;
    for (const bucket of body.data) {
      for (const result of bucket.results) {
        totalCents += Number(result.amount);
      }
    }

    page = body.has_more ? (body.next_page ?? undefined) : undefined;
  } while (page);

  return totalCents / 100;
}
