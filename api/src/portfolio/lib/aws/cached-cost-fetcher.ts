import { GetCommand, PutCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";

export interface CachedCostFetcherConfig {
  ddb: DynamoDBDocumentClient;
  tableName: string;
  cacheKey: { pk: string; sk: string };
  cacheTtlMs: number;
}

const RETENTION_DAYS = 30;

// Shared cache/coalesce/claim template for portfolio's two "all-time cost"
// footer figures (AWS, Anthropic). Both cache their (paid/rate-limited)
// upstream fetch in DynamoDB, coalesce concurrent in-process calls (the
// footer queries awsCostUsd/anthropicCostUsd/totalCostUsd as three sibling
// fields, and totalCostUsd calls both again), and claim a refresh with a
// conditional write so racing Lambda containers don't all pay for a
// duplicate fetch past an expired cache.
export abstract class CachedCostFetcher {
  private inFlight: Promise<number> | null = null;

  constructor(private readonly config: CachedCostFetcherConfig) {}

  protected abstract fetchRaw(now: Date): Promise<number>;

  // Called when fetchRaw() throws, after the refresh claim has already been
  // released. AWS's fetcher rethrows so the caller sees the failure;
  // Anthropic's swallows it and returns the last-known cached amount, since
  // its footer figure is a nice-to-have, not core functionality.
  protected abstract onFetchError(err: unknown, cachedAmountUsd: number): Promise<number>;

  // Optional early exit before any cache/claim DynamoDB calls - e.g. the
  // Anthropic fetcher returns 0 outright when no admin API key is
  // configured, without ever touching the cache table. Runs inside the same
  // coalesced call as everything else, so concurrent callers share it too.
  protected async guard(): Promise<number | null> {
    return null;
  }

  async getAllTimeCostUsd(): Promise<number> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.run().finally(() => {
      this.inFlight = null;
    });

    return this.inFlight;
  }

  private async run(): Promise<number> {
    const guarded = await this.guard();

    return guarded !== null ? guarded : this.fetchAllTimeCostUsd();
  }

  private ttl(): number {
    return Math.floor(Date.now() / 1000) + RETENTION_DAYS * 24 * 60 * 60;
  }

  private async fetchAllTimeCostUsd(): Promise<number> {
    const { ddb, tableName, cacheKey, cacheTtlMs } = this.config;

    const cached = await ddb.send(new GetCommand({ TableName: tableName, Key: cacheKey }));
    const fetchedAt = cached.Item?.fetchedAt as string | undefined;
    const cachedAmountUsd = (cached.Item?.amountUsd as number | undefined) ?? 0;
    if (fetchedAt && Date.now() - new Date(fetchedAt).getTime() < cacheTtlMs) {
      return cachedAmountUsd;
    }

    const now = new Date();

    // Claim the refresh before calling the real (paid/rate-limited) fetch
    // below - the condition only lets the container that read the cache
    // first "win"; the rest fall back to the last cached amount instead of
    // duplicating the fetch.
    try {
      await ddb.send(
        new PutCommand({
          TableName: tableName,
          Item: { ...cacheKey, amountUsd: cachedAmountUsd, fetchedAt: now.toISOString(), ttl: this.ttl() },
          ConditionExpression: fetchedAt ? "fetchedAt = :prevFetchedAt" : "attribute_not_exists(fetchedAt)",
          ExpressionAttributeValues: fetchedAt ? { ":prevFetchedAt": fetchedAt } : undefined,
        })
      );
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) return cachedAmountUsd;
      throw err;
    }

    let amountUsd: number;
    try {
      amountUsd = await this.fetchRaw(now);
    } catch (err) {
      // Release the claim (restore the pre-claim fetchedAt, or clear it if
      // this was the first-ever fetch) so a still-stale cache keeps
      // retrying on the next request instead of sitting "fresh" for a full
      // cache window after a failure.
      await ddb
        .send(
          new PutCommand({
            TableName: tableName,
            Item: {
              ...cacheKey,
              amountUsd: cachedAmountUsd,
              ...(fetchedAt ? { fetchedAt } : {}),
              ttl: this.ttl(),
            },
          })
        )
        .catch(() => {});

      return this.onFetchError(err, cachedAmountUsd);
    }

    await ddb.send(
      new PutCommand({
        TableName: tableName,
        Item: { ...cacheKey, amountUsd, fetchedAt: now.toISOString(), ttl: this.ttl() },
      })
    );

    return amountUsd;
  }
}
