import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import type { GameRecord } from "../game";
import { TABLE_NAME } from "./ddb";
import { DynamoImposterStore } from "./store";

const ddbMock = mockClient(DynamoDBDocumentClient);

function makeGame(overrides: Partial<GameRecord> = {}): GameRecord {
  return {
    gameId: "ABCDE",
    categoryLabel: "Animals",
    hideCategory: false,
    hintEnabled: true,
    phase: "REVEAL",
    players: [{ id: "p1", name: "Alice", hasRevealed: false }],
    imposterIndexes: [0],
    civilianWord: "Cat",
    imposterWord: "Dog",
    createdAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function conditionalCheckFailed() {
  return new ConditionalCheckFailedException({ message: "conditional check failed", $metadata: {} });
}

describe("DynamoImposterStore", () => {
  const store = new DynamoImposterStore();

  beforeEach(() => {
    ddbMock.reset();
  });

  describe("getGame", () => {
    it("returns null when no item exists for that gameId", async () => {
      ddbMock.on(GetCommand).resolves({});

      const result = await store.getGame("ZZZZZ");

      expect(result).toBeNull();

      const calls = ddbMock.commandCalls(GetCommand);
      expect(calls[0].args[0].input).toMatchObject({
        TableName: TABLE_NAME,
        Key: { pk: "GAME#ZZZZZ", sk: "STATE" },
      });
    });

    it("returns the stored game record when found", async () => {
      const game = makeGame();
      ddbMock.on(GetCommand).resolves({ Item: { data: game } });

      const result = await store.getGame(game.gameId);

      expect(result).toEqual(game);
    });
  });

  describe("listLiveGames", () => {
    it("returns an empty array when there are no live games", async () => {
      ddbMock.on(QueryCommand).resolves({});

      const result = await store.listLiveGames();

      expect(result).toEqual([]);
    });

    it("queries the live-games GSI and unwraps each item's data, newest first", async () => {
      const gameA = makeGame({ gameId: "AAAAA" });
      const gameB = makeGame({ gameId: "BBBBB" });
      ddbMock.on(QueryCommand).resolves({ Items: [{ data: gameA }, { data: gameB }] });

      const result = await store.listLiveGames();

      expect(result).toEqual([gameA, gameB]);

      const calls = ddbMock.commandCalls(QueryCommand);
      expect(calls[0].args[0].input).toMatchObject({
        TableName: TABLE_NAME,
        IndexName: "GSI1",
        KeyConditionExpression: "gsi1pk = :pk",
        ExpressionAttributeValues: { ":pk": "LIVE" },
        ScanIndexForward: false,
      });
    });
  });

  describe("saveGame", () => {
    it("writes the live-games GSI attributes for a game still in progress", async () => {
      ddbMock.on(PutCommand).resolves({});

      const game = makeGame({ phase: "DISCUSSION" });

      await store.saveGame(game);

      const calls = ddbMock.commandCalls(PutCommand);
      expect(calls[0].args[0].input.Item).toMatchObject({
        pk: "GAME#ABCDE",
        sk: "STATE",
        data: game,
        gsi1pk: "LIVE",
        gsi1sk: game.createdAt,
      });
    });

    it("omits the live-games GSI attributes once the game has reached RESULTS", async () => {
      ddbMock.on(PutCommand).resolves({});

      const game = makeGame({ phase: "RESULTS" });

      await store.saveGame(game);

      const calls = ddbMock.commandCalls(PutCommand);
      const item = calls[0].args[0].input.Item as Record<string, unknown>;
      expect(item).not.toHaveProperty("gsi1pk");
      expect(item).not.toHaveProperty("gsi1sk");
    });
  });

  describe("createGame", () => {
    it("builds the game with a generated gameId and persists it with a not-exists condition", async () => {
      ddbMock.on(PutCommand).resolves({});

      const game = await store.createGame((gameId) => makeGame({ gameId }));

      expect(game.gameId).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/);

      const calls = ddbMock.commandCalls(PutCommand);
      expect(calls).toHaveLength(1);
      expect(calls[0].args[0].input.ConditionExpression).toBe("attribute_not_exists(pk)");
    });

    it("retries with a freshly generated gameId on an id collision", async () => {
      ddbMock.on(PutCommand).rejectsOnce(conditionalCheckFailed()).resolves({});

      const game = await store.createGame((gameId) => makeGame({ gameId }));

      expect(ddbMock.commandCalls(PutCommand)).toHaveLength(2);
      expect(game.gameId).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/);
    });

    it("gives up after 5 collisions", async () => {
      ddbMock.on(PutCommand).rejects(conditionalCheckFailed());

      await expect(store.createGame((gameId) => makeGame({ gameId }))).rejects.toThrow(
        "Couldn't allocate a game code - please try again."
      );
      expect(ddbMock.commandCalls(PutCommand)).toHaveLength(5);
    });

    it("propagates an unexpected (non-collision) error immediately without retrying", async () => {
      ddbMock.on(PutCommand).rejects(new Error("ddb is down"));

      await expect(store.createGame((gameId) => makeGame({ gameId }))).rejects.toThrow("ddb is down");
      expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
    });
  });
});
