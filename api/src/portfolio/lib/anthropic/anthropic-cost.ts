import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { captureAwsClient } from "api-shared/xray";
import { ddb, TABLE_NAME } from "../aws/ddb";
import { CachedCostFetcher } from "../aws/cached-cost-fetcher";

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

  const client = captureAwsClient(new SecretsManagerClient({}));
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

class AnthropicCostFetcher extends CachedCostFetcher {
  constructor() {
    super({
      ddb,
      tableName: TABLE_NAME,
      cacheKey: { pk: "STATS", sk: "ANTHROPIC_COST" },
      // 25h, not 1h - cost-refresh-handler.ts proactively refreshes this
      // once a day now (see its own comment), so this TTL only matters as a
      // backstop if that schedule ever misses a day. Was 1h, which meant a
      // real visitor's request paid for this fetch roughly every hour;
      // paginating up to a dozen sequential requests against Anthropic's
      // cost API (each with its own 8s timeout) once left one real request
      // blocked for ~17s. The 1h-freshness this bought was never the point -
      // a footer figure doesn't need to be that current.
      cacheTtlMs: 25 * 60 * 60 * 1000,
    });
  }

  // Requires an Admin API key (separate from the messages-API key used
  // elsewhere) - returns 0 rather than failing if it's not configured,
  // since this is a nice-to-have footer figure, not core functionality.
  // Only checks whether a credential *source* is configured (a plain env
  // read, no network call) - actually fetching the secret's value is
  // deferred to fetchRaw(), so a fresh cache hit never pays that Secrets
  // Manager round trip. Still runs before any cache/claim DynamoDB calls,
  // same as the original early-return did.
  protected async guard(): Promise<number | null> {
    const hasCredentialSource = Boolean(
      process.env.ANTHROPIC_ADMIN_API_KEY || process.env.ANTHROPIC_ADMIN_SECRET_ARN
    );

    return hasCredentialSource ? null : 0;
  }

  protected async fetchRaw(now: Date): Promise<number> {
    // Only reached once guard() has confirmed a credential source exists and
    // the cache has been found stale - getAnthropicAdminApiKey() is memoized
    // at module scope, so this is still just one Secrets Manager call per
    // warm container, now paid only when actually needed.
    const apiKey = await getAnthropicAdminApiKey();
    if (!apiKey) return 0;

    // 12 months back comfortably covers this project's whole history (and
    // matches the same lookback used for the AWS side); the cost endpoint
    // caps at 31 daily buckets per page, so a range this wide means
    // fetchAnthropicCostUsd paginates through roughly a dozen requests.
    const startingAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12, 1));
    const endingAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    return fetchAnthropicCostUsd(apiKey, startingAt, endingAt);
  }

  protected async onFetchError(err: unknown, cachedAmountUsd: number): Promise<number> {
    console.error("Failed to fetch Anthropic cost report:", err);

    return cachedAmountUsd;
  }
}

const anthropicCostFetcher = new AnthropicCostFetcher();

export async function getAnthropicAllTimeCostUsd(): Promise<number> {
  return anthropicCostFetcher.getAllTimeCostUsd();
}
