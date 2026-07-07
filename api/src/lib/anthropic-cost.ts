import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { ddb, TABLE_NAME } from "./ddb";

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
export async function getAnthropicCostThisMonthUsd(): Promise<number> {
  const apiKey = await getAnthropicAdminApiKey();
  if (!apiKey) return 0;

  const cached = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: CACHE_KEY }));
  const fetchedAt = cached.Item?.fetchedAt as string | undefined;
  if (fetchedAt && Date.now() - new Date(fetchedAt).getTime() < CACHE_TTL_MS) {
    return cached.Item?.amountUsd as number;
  }

  const now = new Date();
  const startingAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const endingAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  let amountUsd: number;
  try {
    amountUsd = await fetchAnthropicCostThisMonthUsd(apiKey, startingAt, endingAt);
  } catch (err) {
    console.error("Failed to fetch Anthropic cost report:", err);
    return (cached.Item?.amountUsd as number | undefined) ?? 0;
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

async function fetchAnthropicCostThisMonthUsd(
  apiKey: string,
  startingAt: Date,
  endingAt: Date
): Promise<number> {
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
      signal: AbortSignal.timeout(5000),
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
