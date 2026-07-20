import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CachedCostFetcher } from "./cached-cost-fetcher";

const TABLE_NAME = "test-table";
const CACHE_KEY = { pk: "STATS", sk: "TEST_COST" };
const CACHE_TTL_MS = 60 * 60 * 1000;

// A minimal, fully-controllable ddb double - CachedCostFetcher only ever
// calls .send(), so a plain vi.fn is enough without pulling in
// aws-sdk-client-mock's class-level prototype patching for this file.
function fakeDdb() {
  return { send: vi.fn() } as unknown as DynamoDBDocumentClient & { send: ReturnType<typeof vi.fn> };
}

class TestFetcher extends CachedCostFetcher {
  fetchRawMock = vi.fn<(now: Date) => Promise<number>>();
  onFetchErrorMock = vi.fn<(err: unknown, cachedAmountUsd: number) => Promise<number>>();
  guardMock: (() => Promise<number | null>) | null = null;

  protected async fetchRaw(now: Date): Promise<number> {
    return this.fetchRawMock(now);
  }

  protected async onFetchError(err: unknown, cachedAmountUsd: number): Promise<number> {
    return this.onFetchErrorMock(err, cachedAmountUsd);
  }

  protected async guard(): Promise<number | null> {
    return this.guardMock ? this.guardMock() : super.guard();
  }
}

function makeFetcher(ddb: DynamoDBDocumentClient, cacheTtlMs = CACHE_TTL_MS) {
  return new TestFetcher({ ddb, tableName: TABLE_NAME, cacheKey: CACHE_KEY, cacheTtlMs });
}

describe("CachedCostFetcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the guard's value immediately without touching DynamoDB", async () => {
    const ddb = fakeDdb();
    const fetcher = makeFetcher(ddb);
    fetcher.guardMock = async () => 0;

    const result = await fetcher.getAllTimeCostUsd();

    expect(result).toBe(0);
    expect(ddb.send).not.toHaveBeenCalled();
    expect(fetcher.fetchRawMock).not.toHaveBeenCalled();
  });

  it("falls through to a real fetch when guard returns null", async () => {
    const ddb = fakeDdb();
    ddb.send.mockResolvedValueOnce({ Item: undefined }); // GetCommand: no cache yet
    ddb.send.mockResolvedValueOnce({}); // PutCommand: claim
    ddb.send.mockResolvedValueOnce({}); // PutCommand: store result

    const fetcher = makeFetcher(ddb);
    fetcher.guardMock = async () => null;
    fetcher.fetchRawMock.mockResolvedValue(42);

    const result = await fetcher.getAllTimeCostUsd();

    expect(result).toBe(42);
    expect(fetcher.fetchRawMock).toHaveBeenCalledOnce();
  });

  it("returns the cached amount without calling fetchRaw when the cache is still fresh", async () => {
    const ddb = fakeDdb();
    ddb.send.mockResolvedValueOnce({
      Item: { ...CACHE_KEY, amountUsd: 12.5, fetchedAt: "2026-06-15T11:30:00.000Z" }, // 30 min ago, TTL is 1h
    });

    const fetcher = makeFetcher(ddb);

    const result = await fetcher.getAllTimeCostUsd();

    expect(result).toBe(12.5);
    expect(ddb.send).toHaveBeenCalledOnce(); // only the GetCommand
    expect(fetcher.fetchRawMock).not.toHaveBeenCalled();
  });

  it("refetches when the cache has expired", async () => {
    const ddb = fakeDdb();
    ddb.send.mockResolvedValueOnce({
      Item: { ...CACHE_KEY, amountUsd: 12.5, fetchedAt: "2026-06-15T10:00:00.000Z" }, // 2h ago, TTL is 1h
    });
    ddb.send.mockResolvedValueOnce({}); // claim PutCommand
    ddb.send.mockResolvedValueOnce({}); // store PutCommand

    const fetcher = makeFetcher(ddb);
    fetcher.fetchRawMock.mockResolvedValue(99);

    const result = await fetcher.getAllTimeCostUsd();

    expect(result).toBe(99);
    expect(fetcher.fetchRawMock).toHaveBeenCalledOnce();
  });

  it("claims the refresh with attribute_not_exists when there is no prior fetchedAt", async () => {
    const ddb = fakeDdb();
    ddb.send.mockResolvedValueOnce({ Item: undefined });
    ddb.send.mockResolvedValueOnce({});
    ddb.send.mockResolvedValueOnce({});

    const fetcher = makeFetcher(ddb);
    fetcher.fetchRawMock.mockResolvedValue(7);

    await fetcher.getAllTimeCostUsd();

    const claimCall = ddb.send.mock.calls[1][0] as PutCommand;
    expect(claimCall.input.ConditionExpression).toBe("attribute_not_exists(fetchedAt)");
    expect(claimCall.input.ExpressionAttributeValues).toBeUndefined();
  });

  it("claims the refresh conditioned on the previous fetchedAt when one exists", async () => {
    const ddb = fakeDdb();
    const prevFetchedAt = "2026-06-15T10:00:00.000Z";
    ddb.send.mockResolvedValueOnce({ Item: { ...CACHE_KEY, amountUsd: 1, fetchedAt: prevFetchedAt } });
    ddb.send.mockResolvedValueOnce({});
    ddb.send.mockResolvedValueOnce({});

    const fetcher = makeFetcher(ddb);
    fetcher.fetchRawMock.mockResolvedValue(7);

    await fetcher.getAllTimeCostUsd();

    const claimCall = ddb.send.mock.calls[1][0] as PutCommand;
    expect(claimCall.input.ConditionExpression).toBe("fetchedAt = :prevFetchedAt");
    expect(claimCall.input.ExpressionAttributeValues).toEqual({ ":prevFetchedAt": prevFetchedAt });
  });

  it("returns the cached amount and skips fetchRaw when another container already won the claim race", async () => {
    const ddb = fakeDdb();
    ddb.send.mockResolvedValueOnce({
      Item: { ...CACHE_KEY, amountUsd: 5, fetchedAt: "2026-06-15T10:00:00.000Z" },
    });
    ddb.send.mockRejectedValueOnce(
      new ConditionalCheckFailedException({ message: "lost the race", $metadata: {} })
    );

    const fetcher = makeFetcher(ddb);

    const result = await fetcher.getAllTimeCostUsd();

    expect(result).toBe(5);
    expect(fetcher.fetchRawMock).not.toHaveBeenCalled();
  });

  it("propagates an unexpected error from the claim PutCommand", async () => {
    const ddb = fakeDdb();
    ddb.send.mockResolvedValueOnce({ Item: undefined });
    ddb.send.mockRejectedValueOnce(new Error("dynamo down"));

    const fetcher = makeFetcher(ddb);

    await expect(fetcher.getAllTimeCostUsd()).rejects.toThrow("dynamo down");
    expect(fetcher.fetchRawMock).not.toHaveBeenCalled();
  });

  it("stores the freshly fetched amount on success", async () => {
    const ddb = fakeDdb();
    ddb.send.mockResolvedValueOnce({ Item: undefined });
    ddb.send.mockResolvedValueOnce({});
    ddb.send.mockResolvedValueOnce({});

    const fetcher = makeFetcher(ddb);
    fetcher.fetchRawMock.mockResolvedValue(123.45);

    await fetcher.getAllTimeCostUsd();

    const storeCall = ddb.send.mock.calls[2][0] as PutCommand;
    expect(storeCall.input.Item).toMatchObject({ ...CACHE_KEY, amountUsd: 123.45 });
    expect(storeCall.input.Item?.fetchedAt).toBe("2026-06-15T12:00:00.000Z");
    expect(storeCall.input.Item?.ttl).toBe(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60);
  });

  it("releases the claim and delegates to onFetchError when fetchRaw throws, restoring the prior fetchedAt", async () => {
    const ddb = fakeDdb();
    const prevFetchedAt = "2026-06-15T10:00:00.000Z";
    ddb.send.mockResolvedValueOnce({ Item: { ...CACHE_KEY, amountUsd: 5, fetchedAt: prevFetchedAt } }); // GetCommand
    ddb.send.mockResolvedValueOnce({}); // claim PutCommand
    ddb.send.mockResolvedValueOnce({}); // release PutCommand

    const fetcher = makeFetcher(ddb);
    const boom = new Error("upstream 500");
    fetcher.fetchRawMock.mockRejectedValue(boom);
    fetcher.onFetchErrorMock.mockResolvedValue(5);

    const result = await fetcher.getAllTimeCostUsd();

    expect(result).toBe(5);
    expect(fetcher.onFetchErrorMock).toHaveBeenCalledWith(boom, 5);

    const releaseCall = ddb.send.mock.calls[2][0] as PutCommand;
    expect(releaseCall.input.Item).toMatchObject({ ...CACHE_KEY, amountUsd: 5, fetchedAt: prevFetchedAt });
  });

  it("releases the claim with no fetchedAt when this was the first-ever fetch and it failed", async () => {
    const ddb = fakeDdb();
    ddb.send.mockResolvedValueOnce({ Item: undefined }); // GetCommand: nothing cached yet
    ddb.send.mockResolvedValueOnce({}); // claim PutCommand
    ddb.send.mockResolvedValueOnce({}); // release PutCommand

    const fetcher = makeFetcher(ddb);
    fetcher.fetchRawMock.mockRejectedValue(new Error("boom"));
    fetcher.onFetchErrorMock.mockResolvedValue(0);

    await fetcher.getAllTimeCostUsd();

    const releaseCall = ddb.send.mock.calls[2][0] as PutCommand;
    expect(releaseCall.input.Item).not.toHaveProperty("fetchedAt");
    expect(releaseCall.input.Item).toMatchObject({ ...CACHE_KEY, amountUsd: 0 });
  });

  it("still calls onFetchError even if releasing the claim itself fails", async () => {
    const ddb = fakeDdb();
    ddb.send.mockResolvedValueOnce({ Item: undefined });
    ddb.send.mockResolvedValueOnce({});
    ddb.send.mockRejectedValueOnce(new Error("release failed too"));

    const fetcher = makeFetcher(ddb);
    fetcher.fetchRawMock.mockRejectedValue(new Error("boom"));
    fetcher.onFetchErrorMock.mockResolvedValue(0);

    const result = await fetcher.getAllTimeCostUsd();

    expect(result).toBe(0);
    expect(fetcher.onFetchErrorMock).toHaveBeenCalled();
  });

  it("coalesces concurrent calls into a single in-flight fetch", async () => {
    const ddb = fakeDdb();
    // Every call (GetCommand, both PutCommands) can resolve generically here -
    // the coalescing itself is what's under test, not the cache/claim shape.
    ddb.send.mockResolvedValue({ Item: undefined });

    const fetcher = makeFetcher(ddb);
    let resolveFetch!: (value: number) => void;
    // fetchRaw's promise only actually gets constructed after a few
    // microtask hops (the GetCommand/claim-PutCommand awaits ahead of it),
    // so resolveFetch isn't assigned the instant getAllTimeCostUsd() is
    // called - wait for that assignment via this deferred signal instead of
    // racing it.
    const fetchStarted = new Promise<void>((signalStarted) => {
      fetcher.fetchRawMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
            signalStarted();
          })
      );
    });

    const call1 = fetcher.getAllTimeCostUsd();
    const call2 = fetcher.getAllTimeCostUsd();
    await fetchStarted;
    resolveFetch(50);

    const [result1, result2] = await Promise.all([call1, call2]);

    expect(result1).toBe(50);
    expect(result2).toBe(50);
    expect(fetcher.fetchRawMock).toHaveBeenCalledOnce();
  });

  it("does not coalesce calls that happen after the previous one has already finished", async () => {
    const ddb = fakeDdb();
    ddb.send.mockResolvedValue({ Item: undefined });

    const fetcher = makeFetcher(ddb);
    fetcher.fetchRawMock.mockResolvedValue(1);

    await fetcher.getAllTimeCostUsd();
    await fetcher.getAllTimeCostUsd();

    expect(fetcher.fetchRawMock).toHaveBeenCalledTimes(2);
  });
});
