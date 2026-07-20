import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRateLimiter } from "./rate-limit";

const ddbMock = mockClient(DynamoDBDocumentClient);

describe("createRateLimiter", () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips the check entirely when no sourceIp is available (e.g. local dev)", async () => {
    const assertNotRateLimited = createRateLimiter({
      ddb: ddbMock as unknown as DynamoDBDocumentClient,
      tableName: "my-table",
      limitPerMinute: 10,
    });

    await expect(assertNotRateLimited(undefined)).resolves.toBeUndefined();
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it("issues an UpdateCommand against the caller's table, keyed by IP + minute bucket", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T10:00:30.000Z"));
    ddbMock.on(UpdateCommand).resolves({});

    const assertNotRateLimited = createRateLimiter({
      ddb: ddbMock as unknown as DynamoDBDocumentClient,
      tableName: "my-table",
      limitPerMinute: 5,
    });

    await assertNotRateLimited("1.2.3.4");

    const calls = ddbMock.commandCalls(UpdateCommand);
    expect(calls).toHaveLength(1);

    const input = calls[0].args[0].input;

    const expectedBucket = Math.floor(new Date("2026-07-20T10:00:30.000Z").getTime() / 60_000);
    expect(input.TableName).toBe("my-table");
    expect(input.Key).toEqual({ pk: `RATE#1.2.3.4#${expectedBucket}`, sk: "COUNT" });
    expect(input.ExpressionAttributeValues).toMatchObject({ ":incr": 1, ":limit": 5 });
  });

  it("defaults the TTL window to 120 seconds when windowSeconds is omitted", async () => {
    vi.useFakeTimers();

    const now = new Date("2026-07-20T10:00:00.000Z");
    vi.setSystemTime(now);
    ddbMock.on(UpdateCommand).resolves({});

    const assertNotRateLimited = createRateLimiter({
      ddb: ddbMock as unknown as DynamoDBDocumentClient,
      tableName: "my-table",
      limitPerMinute: 5,
    });

    await assertNotRateLimited("5.6.7.8");

    const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    const expectedTtl = Math.floor(now.getTime() / 1000) + 120;
    expect(input.ExpressionAttributeValues?.[":ttl"]).toBe(expectedTtl);
  });

  it("honors a custom windowSeconds for the TTL", async () => {
    vi.useFakeTimers();

    const now = new Date("2026-07-20T10:00:00.000Z");
    vi.setSystemTime(now);
    ddbMock.on(UpdateCommand).resolves({});

    const assertNotRateLimited = createRateLimiter({
      ddb: ddbMock as unknown as DynamoDBDocumentClient,
      tableName: "my-table",
      limitPerMinute: 5,
      windowSeconds: 30,
    });

    await assertNotRateLimited("5.6.7.8");

    const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    const expectedTtl = Math.floor(now.getTime() / 1000) + 30;
    expect(input.ExpressionAttributeValues?.[":ttl"]).toBe(expectedTtl);
  });

  it("throws a friendly, user-facing error when the conditional check fails (limit exceeded)", async () => {
    const cause = new ConditionalCheckFailedException({ message: "conditional failed", $metadata: {} });
    ddbMock.on(UpdateCommand).rejects(cause);

    const assertNotRateLimited = createRateLimiter({
      ddb: ddbMock as unknown as DynamoDBDocumentClient,
      tableName: "my-table",
      limitPerMinute: 1,
    });

    await expect(assertNotRateLimited("9.9.9.9")).rejects.toThrow(
      "Too many requests - please wait a moment and try again."
    );
  });

  it("preserves the original ConditionalCheckFailedException as the error's cause", async () => {
    const cause = new ConditionalCheckFailedException({ message: "conditional failed", $metadata: {} });
    ddbMock.on(UpdateCommand).rejects(cause);

    const assertNotRateLimited = createRateLimiter({
      ddb: ddbMock as unknown as DynamoDBDocumentClient,
      tableName: "my-table",
      limitPerMinute: 1,
    });

    try {
      await assertNotRateLimited("9.9.9.9");
      expect.unreachable("expected assertNotRateLimited to throw");
    } catch (err) {
      expect((err as Error).cause).toBe(cause);
    }
  });

  it("rethrows unrelated DynamoDB errors unchanged rather than reporting them as rate limiting", async () => {
    const unrelated = new Error("ProvisionedThroughputExceededException");
    ddbMock.on(UpdateCommand).rejects(unrelated);

    const assertNotRateLimited = createRateLimiter({
      ddb: ddbMock as unknown as DynamoDBDocumentClient,
      tableName: "my-table",
      limitPerMinute: 1,
    });

    await expect(assertNotRateLimited("9.9.9.9")).rejects.toBe(unrelated);
  });
});
