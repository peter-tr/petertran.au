import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createResumePartitionLoader } from "./resume-data";
import { TABLE_NAME, PK } from "./ddb";

const ddbMock = mockClient(DynamoDBDocumentClient);

describe("createResumePartitionLoader", () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  afterEach(() => {
    ddbMock.restore();
  });

  it("queries the RESUME partition with no sort-key condition", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const load = createResumePartitionLoader();

    await load();

    expect(ddbMock.calls()).toHaveLength(1);

    const input = ddbMock.call(0).args[0].input as QueryCommand["input"];
    expect(input.TableName).toBe(TABLE_NAME);
    expect(input.KeyConditionExpression).toBe("pk = :pk");
    expect(input.ExpressionAttributeValues).toEqual({ ":pk": PK });
  });

  it("returns the items from the query", async () => {
    const items = [
      { sk: "PERSON", type: "PERSON", data: { name: "Ada" } },
      { sk: "PROJECT#1", type: "PROJECT", data: { name: "Thing" } },
    ];
    ddbMock.on(QueryCommand).resolves({ Items: items });

    const load = createResumePartitionLoader();

    await expect(load()).resolves.toEqual(items);
  });

  it("returns an empty array when Items is undefined", async () => {
    ddbMock.on(QueryCommand).resolves({});

    const load = createResumePartitionLoader();

    await expect(load()).resolves.toEqual([]);
  });

  it("memoizes: concurrent/sequential calls on the same loader only query once", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const load = createResumePartitionLoader();

    const [a, b] = await Promise.all([load(), load()]);
    await load();

    expect(a).toBe(b);
    expect(ddbMock.calls()).toHaveLength(1);
  });

  it("each loader instance is independent", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const loadA = createResumePartitionLoader();
    const loadB = createResumePartitionLoader();

    await loadA();
    await loadB();

    expect(ddbMock.calls()).toHaveLength(2);
  });
});
