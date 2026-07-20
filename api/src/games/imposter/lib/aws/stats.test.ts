import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { TABLE_NAME } from "./ddb";
import { DynamoImposterStatsTracker } from "./stats";

const ddbMock = mockClient(DynamoDBDocumentClient);

describe("DynamoImposterStatsTracker", () => {
  const tracker = new DynamoImposterStatsTracker();

  beforeEach(() => {
    ddbMock.reset();
  });

  describe("recordGameCreated", () => {
    it("increments the all-time GAMES_TOTAL counter", async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await tracker.recordGameCreated();

      const calls = ddbMock.commandCalls(UpdateCommand);
      expect(calls).toHaveLength(1);
      expect(calls[0].args[0].input).toMatchObject({
        TableName: TABLE_NAME,
        Key: { pk: "STATS", sk: "GAMES_TOTAL" },
        ExpressionAttributeValues: { ":incr": 1 },
      });
    });
  });

  describe("recordGameCompleted", () => {
    it("increments both the completed count and the total duration", async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await tracker.recordGameCompleted(45_000);

      const calls = ddbMock.commandCalls(UpdateCommand);
      expect(calls).toHaveLength(1);
      expect(calls[0].args[0].input).toMatchObject({
        TableName: TABLE_NAME,
        Key: { pk: "STATS", sk: "GAMES_COMPLETED" },
        ExpressionAttributeValues: { ":incrCount": 1, ":incrMs": 45_000 },
      });
    });
  });

  describe("getStats", () => {
    it("defaults every counter to 0 when nothing has ever been recorded", async () => {
      ddbMock.on(GetCommand).resolves({});

      const stats = await tracker.getStats();

      expect(stats).toEqual({ gamesPlayedTotal: 0, gamesCompletedTotal: 0, avgGameDurationMs: 0 });
    });

    it("reads the total games count", async () => {
      ddbMock
        .on(GetCommand, { Key: { pk: "STATS", sk: "GAMES_TOTAL" } })
        .resolves({ Item: { count: 10 } })
        .on(GetCommand, { Key: { pk: "STATS", sk: "GAMES_COMPLETED" } })
        .resolves({});

      const stats = await tracker.getStats();

      expect(stats.gamesPlayedTotal).toBe(10);
    });

    it("computes the average completed-game duration, rounded to one decimal place", async () => {
      ddbMock
        .on(GetCommand, { Key: { pk: "STATS", sk: "GAMES_TOTAL" } })
        .resolves({ Item: { count: 10 } })
        .on(GetCommand, { Key: { pk: "STATS", sk: "GAMES_COMPLETED" } })
        .resolves({ Item: { count: 3, totalDurationMs: 10_000 } });

      const stats = await tracker.getStats();

      expect(stats.gamesCompletedTotal).toBe(3);
      expect(stats.avgGameDurationMs).toBeCloseTo(3333.3, 1);
    });

    it("avoids a division by zero when no games have completed yet, even if some are in progress", async () => {
      ddbMock
        .on(GetCommand, { Key: { pk: "STATS", sk: "GAMES_TOTAL" } })
        .resolves({ Item: { count: 5 } })
        .on(GetCommand, { Key: { pk: "STATS", sk: "GAMES_COMPLETED" } })
        .resolves({});

      const stats = await tracker.getStats();

      expect(stats.gamesPlayedTotal).toBe(5);
      expect(stats.gamesCompletedTotal).toBe(0);
      expect(stats.avgGameDurationMs).toBe(0);
    });
  });
});
