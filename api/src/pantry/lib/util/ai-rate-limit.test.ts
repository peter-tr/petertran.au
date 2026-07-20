import { mockClient } from "aws-sdk-client-mock";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ddb } from "../aws/ddb";
import { assertAiNotRateLimited } from "./ai-rate-limit";

const ddbMock = mockClient(ddb);

describe("assertAiNotRateLimited (pantry Anthropic-call limiter)", () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  afterEach(() => {
    ddbMock.restore();
  });

  it("skips the check entirely when no source IP is given", async () => {
    await expect(assertAiNotRateLimited(undefined)).resolves.toBeUndefined();
    expect(ddbMock.calls()).toHaveLength(0);
  });

  it("allows the request through when under the limit", async () => {
    ddbMock.on(UpdateCommand).resolves({});

    await expect(assertAiNotRateLimited("9.9.9.9")).resolves.toBeUndefined();
    expect(ddbMock.calls()).toHaveLength(1);
  });

  it("throws a friendly error when the conditional check fails (limit exceeded)", async () => {
    ddbMock
      .on(UpdateCommand)
      .rejects(new ConditionalCheckFailedException({ message: "cond failed", $metadata: {} }));

    await expect(assertAiNotRateLimited("9.9.9.9")).rejects.toThrow(
      "Too many requests - please wait a moment and try again."
    );
  });

  it("uses a limit of 15/min, distinct from the 20/min CRUD limiter", async () => {
    ddbMock.on(UpdateCommand).resolves({});

    await assertAiNotRateLimited("9.9.9.9");

    const call = ddbMock.call(0);
    const input = call.args[0].input as { ExpressionAttributeValues: { ":limit": number } };
    expect(input.ExpressionAttributeValues[":limit"]).toBe(15);
  });
});
