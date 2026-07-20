import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { TABLE_NAME } from "../aws/ddb";
import { assertNotRateLimited } from "./rate-limit";

const ddbMock = mockClient(DynamoDBDocumentClient);

describe("assertNotRateLimited (imposter's AI word-pair limiter)", () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it("does nothing and never touches DynamoDB when no source IP is available (e.g. local dev)", async () => {
    await expect(assertNotRateLimited(undefined)).resolves.toBeUndefined();

    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it("allows the request through, writing to this project's own table, when under the limit", async () => {
    ddbMock.on(UpdateCommand).resolves({});

    await assertNotRateLimited("1.2.3.4");

    const calls = ddbMock.commandCalls(UpdateCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.TableName).toBe(TABLE_NAME);
    expect(calls[0].args[0].input.ExpressionAttributeValues).toMatchObject({ ":limit": 5 });
  });

  it("throws a friendly error once the per-minute limit (5) is exceeded", async () => {
    ddbMock
      .on(UpdateCommand)
      .rejects(new ConditionalCheckFailedException({ message: "conditional check failed", $metadata: {} }));

    await expect(assertNotRateLimited("1.2.3.4")).rejects.toThrow(
      "Too many requests - please wait a moment and try again."
    );
  });

  it("propagates unexpected (non-throttling) errors as-is", async () => {
    ddbMock.on(UpdateCommand).rejects(new Error("network blip"));

    await expect(assertNotRateLimited("1.2.3.4")).rejects.toThrow("network blip");
  });
});
