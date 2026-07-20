import { mockClient } from "aws-sdk-client-mock";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ddb } from "../aws/ddb";
import { assertNotRateLimited } from "./rate-limit";

const ddbMock = mockClient(ddb);

describe("assertNotRateLimited (pantry CRUD limiter)", () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  afterEach(() => {
    ddbMock.restore();
  });

  it("skips the check entirely when no source IP is given", async () => {
    await expect(assertNotRateLimited(undefined)).resolves.toBeUndefined();
    expect(ddbMock.calls()).toHaveLength(0);
  });

  it("allows the request through when under the limit", async () => {
    ddbMock.on(UpdateCommand).resolves({});

    await expect(assertNotRateLimited("1.2.3.4")).resolves.toBeUndefined();
    expect(ddbMock.calls()).toHaveLength(1);
  });

  it("throws a friendly error when the conditional check fails (limit exceeded)", async () => {
    ddbMock.on(UpdateCommand).rejects(
      new ConditionalCheckFailedException({ message: "cond failed", $metadata: {} })
    );

    await expect(assertNotRateLimited("1.2.3.4")).rejects.toThrow(
      "Too many requests - please wait a moment and try again."
    );
  });

  it("propagates an unrelated error unchanged", async () => {
    ddbMock.on(UpdateCommand).rejects(new Error("network blip"));

    await expect(assertNotRateLimited("1.2.3.4")).rejects.toThrow("network blip");
  });

  it("keys the update by source IP and a per-minute bucket", async () => {
    ddbMock.on(UpdateCommand).resolves({});

    await assertNotRateLimited("5.6.7.8");

    const call = ddbMock.call(0);
    const input = call.args[0].input as { Key: { pk: string; sk: string } };
    expect(input.Key.pk).toMatch(/^RATE#5\.6\.7\.8#\d+$/);
    expect(input.Key.sk).toBe("COUNT");
  });
});
