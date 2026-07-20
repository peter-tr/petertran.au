import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertNotRateLimited } from "./rate-limit";

// aws-sdk-client-mock patches the client class prototype, so it intercepts
// calls made through this project's own singleton `ddb` instance (created in
// ../aws/ddb.ts) without needing to mock that module directly.
const ddbMock = mockClient(DynamoDBDocumentClient);

describe("assertNotRateLimited (portfolio's 5/min limiter)", () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  afterEach(() => {
    ddbMock.restore();
  });

  it("resolves without touching DynamoDB when there is no source IP", async () => {
    await expect(assertNotRateLimited(undefined)).resolves.toBeUndefined();
    expect(ddbMock.calls()).toHaveLength(0);
  });

  it("resolves when the update succeeds (under the limit)", async () => {
    ddbMock.on(UpdateCommand).resolves({});

    await expect(assertNotRateLimited("1.2.3.4")).resolves.toBeUndefined();
    expect(ddbMock.calls()).toHaveLength(1);

    const input = ddbMock.call(0).args[0].input as UpdateCommand["input"];
    expect(input.ExpressionAttributeValues?.[":limit"]).toBe(5);
    expect((input.Key as { pk: string }).pk).toMatch(/^RATE#1\.2\.3\.4#\d+$/);
  });

  it("throws a friendly error when the conditional check fails (over the limit)", async () => {
    ddbMock
      .on(UpdateCommand)
      .rejects(new ConditionalCheckFailedException({ message: "conditional failed", $metadata: {} }));

    await expect(assertNotRateLimited("5.6.7.8")).rejects.toThrow(
      "Too many requests - please wait a moment and try again."
    );
  });

  it("rethrows unexpected errors as-is", async () => {
    const boom = new Error("dynamo is down");
    ddbMock.on(UpdateCommand).rejects(boom);

    await expect(assertNotRateLimited("9.9.9.9")).rejects.toThrow("dynamo is down");
  });
});
