import { mockClient } from "aws-sdk-client-mock";
import { GetCommand, PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { beforeEach, describe, expect, it } from "vitest";
import { DynamoRepository } from "./dynamo-repository";

interface Widget {
  id: string;
  name: string;
  flag: boolean;
}

// Minimal concrete subclass to exercise the abstract base - applyDefaults
// backfills `flag` when missing, mirroring how inventory.ts/shopping-list.ts
// use this same base for their own per-item defaults.
class WidgetRepository extends DynamoRepository<Widget> {
  applyDefaultsCallCount = 0;

  protected applyDefaults(item: Widget): Widget {
    this.applyDefaultsCallCount++;

    return { ...item, flag: item.flag ?? false };
  }
}

const rawClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(rawClient);
const ddbMock = mockClient(ddb);

function makeRepo() {
  return new WidgetRepository({
    ddb,
    tableName: "test-table",
    pk: "PK1",
    skPrefix: "WIDGET#",
    itemType: "WIDGET",
  });
}

describe("DynamoRepository", () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  describe("get", () => {
    it("returns null when no item is found", async () => {
      ddbMock.on(GetCommand).resolves({});

      const repo = makeRepo();

      await expect(repo.get("missing-id")).resolves.toBeNull();
    });

    it("looks up by pk and the prefixed sort key", async () => {
      ddbMock.on(GetCommand).resolves({});

      const repo = makeRepo();

      await repo.get("abc");

      const input = ddbMock.call(0).args[0].input as { TableName: string; Key: { pk: string; sk: string } };
      expect(input.TableName).toBe("test-table");
      expect(input.Key).toEqual({ pk: "PK1", sk: "WIDGET#abc" });
    });

    it("applies defaults to the found item before returning it", async () => {
      ddbMock.on(GetCommand).resolves({ Item: { data: { id: "abc", name: "Thing" } } });

      const repo = makeRepo();

      const result = await repo.get("abc");

      expect(result).toEqual({ id: "abc", name: "Thing", flag: false });
      expect(repo.applyDefaultsCallCount).toBe(1);
    });

    it("does not call applyDefaults when nothing is found", async () => {
      ddbMock.on(GetCommand).resolves({});

      const repo = makeRepo();

      await repo.get("missing");

      expect(repo.applyDefaultsCallCount).toBe(0);
    });
  });

  describe("getAll", () => {
    it("queries by pk and begins_with on the skPrefix", async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const repo = makeRepo();

      await repo.getAll();

      const input = ddbMock.call(0).args[0].input as {
        TableName: string;
        KeyConditionExpression: string;
        ExpressionAttributeValues: Record<string, string>;
      };
      expect(input.TableName).toBe("test-table");
      expect(input.KeyConditionExpression).toBe("pk = :pk AND begins_with(sk, :prefix)");
      expect(input.ExpressionAttributeValues).toEqual({ ":pk": "PK1", ":prefix": "WIDGET#" });
    });

    it("returns an empty array when Items is absent", async () => {
      ddbMock.on(QueryCommand).resolves({});

      const repo = makeRepo();

      await expect(repo.getAll()).resolves.toEqual([]);
    });

    it("applies defaults to every returned item", async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [{ data: { id: "1", name: "A" } }, { data: { id: "2", name: "B", flag: true } }],
      });

      const repo = makeRepo();

      const result = await repo.getAll();

      expect(result).toEqual([
        { id: "1", name: "A", flag: false },
        { id: "2", name: "B", flag: true },
      ]);
      expect(repo.applyDefaultsCallCount).toBe(2);
    });
  });

  describe("put", () => {
    it("writes the item under the prefixed key with the configured item type", async () => {
      ddbMock.on(PutCommand).resolves({});

      const repo = makeRepo();
      const item: Widget = { id: "xyz", name: "Gadget", flag: true };

      await repo.put(item);

      const input = ddbMock.call(0).args[0].input as {
        TableName: string;
        Item: { pk: string; sk: string; type: string; data: Widget };
      };
      expect(input.TableName).toBe("test-table");
      expect(input.Item).toEqual({ pk: "PK1", sk: "WIDGET#xyz", type: "WIDGET", data: item });
    });
  });

  describe("delete", () => {
    it("returns true when an item was actually deleted (ReturnValues has attributes)", async () => {
      ddbMock.on(DeleteCommand).resolves({ Attributes: { id: "abc" } });

      const repo = makeRepo();

      await expect(repo.delete("abc")).resolves.toBe(true);
    });

    it("returns false when nothing existed to delete", async () => {
      ddbMock.on(DeleteCommand).resolves({});

      const repo = makeRepo();

      await expect(repo.delete("missing")).resolves.toBe(false);
    });

    it("requests ALL_OLD return values so it can tell whether anything was deleted", async () => {
      ddbMock.on(DeleteCommand).resolves({});

      const repo = makeRepo();

      await repo.delete("abc");

      const input = ddbMock.call(0).args[0].input as {
        ReturnValues: string;
        Key: { pk: string; sk: string };
      };
      expect(input.ReturnValues).toBe("ALL_OLD");
      expect(input.Key).toEqual({ pk: "PK1", sk: "WIDGET#abc" });
    });
  });
});
