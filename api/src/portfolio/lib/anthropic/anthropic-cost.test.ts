import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ddbMock = mockClient(DynamoDBDocumentClient);
const secretsManagerMock = mockClient(SecretsManagerClient);
const fetchMock = vi.fn();

// anthropic-cost.ts memoizes the admin API key at module scope forever once
// resolved, and `anthropicCostFetcher` itself is a module-level singleton -
// so every test re-imports the module fresh (vi.resetModules) to avoid one
// test's resolved key / cache state leaking into the next.
async function importGetAnthropicAllTimeCostUsd() {
  const mod = await import("./anthropic-cost");

  return mod.getAnthropicAllTimeCostUsd;
}

describe("getAnthropicAllTimeCostUsd", () => {
  const originalApiKey = process.env.ANTHROPIC_ADMIN_API_KEY;
  const originalSecretArn = process.env.ANTHROPIC_ADMIN_SECRET_ARN;

  beforeEach(() => {
    vi.resetModules();
    ddbMock.reset();
    secretsManagerMock.reset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));
    delete process.env.ANTHROPIC_ADMIN_API_KEY;
    delete process.env.ANTHROPIC_ADMIN_SECRET_ARN;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (originalApiKey === undefined) delete process.env.ANTHROPIC_ADMIN_API_KEY;
    else process.env.ANTHROPIC_ADMIN_API_KEY = originalApiKey;
    if (originalSecretArn === undefined) delete process.env.ANTHROPIC_ADMIN_SECRET_ARN;
    else process.env.ANTHROPIC_ADMIN_SECRET_ARN = originalSecretArn;
  });

  it("returns 0 without touching DynamoDB or the network when no admin key is configured", async () => {
    const getAnthropicAllTimeCostUsd = await importGetAnthropicAllTimeCostUsd();

    const result = await getAnthropicAllTimeCostUsd();

    expect(result).toBe(0);
    expect(ddbMock.calls()).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses ANTHROPIC_ADMIN_API_KEY directly when set, without calling Secrets Manager", async () => {
    process.env.ANTHROPIC_ADMIN_API_KEY = "sk-admin-direct";
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    ddbMock.on(PutCommand).resolves({});
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ results: [{ amount: "100" }] }], has_more: false, next_page: null }),
    });

    const getAnthropicAllTimeCostUsd = await importGetAnthropicAllTimeCostUsd();

    const result = await getAnthropicAllTimeCostUsd();

    expect(result).toBe(1);
    expect(secretsManagerMock.calls()).toHaveLength(0);

    const [, options] = fetchMock.mock.calls[0];
    expect((options.headers as Record<string, string>)["x-api-key"]).toBe("sk-admin-direct");
  });

  it("falls back to Secrets Manager when only ANTHROPIC_ADMIN_SECRET_ARN is set", async () => {
    process.env.ANTHROPIC_ADMIN_SECRET_ARN = "arn:aws:secretsmanager:...:admin-key";
    secretsManagerMock.on(GetSecretValueCommand).resolves({ SecretString: "sk-from-secrets" });
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    ddbMock.on(PutCommand).resolves({});
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], has_more: false, next_page: null }),
    });

    const getAnthropicAllTimeCostUsd = await importGetAnthropicAllTimeCostUsd();

    await getAnthropicAllTimeCostUsd();

    expect(secretsManagerMock.calls()).toHaveLength(1);

    const [, options] = fetchMock.mock.calls[0];
    expect((options.headers as Record<string, string>)["x-api-key"]).toBe("sk-from-secrets");
  });

  it("returns 0 when the secret exists but has no SecretString", async () => {
    process.env.ANTHROPIC_ADMIN_SECRET_ARN = "arn:aws:secretsmanager:...:admin-key";
    secretsManagerMock.on(GetSecretValueCommand).resolves({ SecretString: undefined });
    // guard() can only cheaply confirm a credential *source* is configured -
    // discovering the secret's actual value is empty happens inside
    // fetchRaw(), after the (empty) cache has already been checked/claimed.
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    ddbMock.on(PutCommand).resolves({});

    const getAnthropicAllTimeCostUsd = await importGetAnthropicAllTimeCostUsd();

    const result = await getAnthropicAllTimeCostUsd();

    expect(result).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requests a 12-months-back to 1-month-forward window with a 31-day page limit", async () => {
    process.env.ANTHROPIC_ADMIN_API_KEY = "sk-admin";
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    ddbMock.on(PutCommand).resolves({});
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], has_more: false, next_page: null }),
    });

    const getAnthropicAllTimeCostUsd = await importGetAnthropicAllTimeCostUsd();

    await getAnthropicAllTimeCostUsd();

    const [url] = fetchMock.mock.calls[0];
    const parsed = new URL(url as string);
    expect(parsed.origin + parsed.pathname).toBe("https://api.anthropic.com/v1/organizations/cost_report");
    expect(parsed.searchParams.get("starting_at")).toBe("2025-06-01T00:00:00.000Z");
    expect(parsed.searchParams.get("ending_at")).toBe("2026-07-01T00:00:00.000Z");
    expect(parsed.searchParams.get("limit")).toBe("31");
    expect(parsed.searchParams.has("page")).toBe(false);
  });

  it("paginates through has_more/next_page and sums cents into dollars", async () => {
    process.env.ANTHROPIC_ADMIN_API_KEY = "sk-admin";
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    ddbMock.on(PutCommand).resolves({});
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ results: [{ amount: "150" }, { amount: "50" }] }],
          has_more: true,
          next_page: "page-2",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ results: [{ amount: "300" }] }], has_more: false, next_page: null }),
      });

    const getAnthropicAllTimeCostUsd = await importGetAnthropicAllTimeCostUsd();

    const result = await getAnthropicAllTimeCostUsd();

    expect(result).toBe(5); // (150 + 50 + 300) cents = 500 cents = $5
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const secondCallUrl = new URL(fetchMock.mock.calls[1][0] as string);
    expect(secondCallUrl.searchParams.get("page")).toBe("page-2");
  });

  it("returns the last-known cached amount (and does not throw) when the fetch fails", async () => {
    process.env.ANTHROPIC_ADMIN_API_KEY = "sk-admin";
    ddbMock.on(GetCommand).resolves({
      Item: { pk: "STATS", sk: "ANTHROPIC_COST", amountUsd: 8.5, fetchedAt: "2020-01-01T00:00:00.000Z" },
    });
    ddbMock.on(PutCommand).resolves({});
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const getAnthropicAllTimeCostUsd = await importGetAnthropicAllTimeCostUsd();

    const result = await getAnthropicAllTimeCostUsd();

    expect(result).toBe(8.5);
    expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to fetch Anthropic cost report:", expect.any(Error));
    consoleErrorSpy.mockRestore();
  });

  it("returns the cached amount without calling fetch when the 1h cache is still fresh", async () => {
    process.env.ANTHROPIC_ADMIN_API_KEY = "sk-admin";
    ddbMock.on(GetCommand).resolves({
      Item: { pk: "STATS", sk: "ANTHROPIC_COST", amountUsd: 3.25, fetchedAt: "2026-06-15T11:30:00.000Z" },
    });

    const getAnthropicAllTimeCostUsd = await importGetAnthropicAllTimeCostUsd();

    const result = await getAnthropicAllTimeCostUsd();

    expect(result).toBe(3.25);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never calls Secrets Manager on a fresh cache hit, even with only a secret ARN configured", async () => {
    process.env.ANTHROPIC_ADMIN_SECRET_ARN = "arn:aws:secretsmanager:...:admin-key";
    ddbMock.on(GetCommand).resolves({
      Item: { pk: "STATS", sk: "ANTHROPIC_COST", amountUsd: 3.25, fetchedAt: "2026-06-15T11:30:00.000Z" },
    });

    const getAnthropicAllTimeCostUsd = await importGetAnthropicAllTimeCostUsd();

    const result = await getAnthropicAllTimeCostUsd();

    expect(result).toBe(3.25);
    expect(secretsManagerMock.calls()).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
