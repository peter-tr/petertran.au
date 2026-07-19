import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME } from "./ddb";
import type { ImposterStats } from "../game";
import type { ImposterStatsTracker } from "../../resolvers/resolvers";

// All-time, anonymized usage stats for the game - running counters only.
// Individual live games are listed separately via liveImposterGames (see
// ../aws/store.ts's listLiveGames) - these counters stay aggregate-only
// because they're all-time totals, not a way to browse specific sessions.

const STATS_PK = "STATS";

export class DynamoImposterStatsTracker implements ImposterStatsTracker {
  async recordGameCreated(): Promise<void> {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { pk: STATS_PK, sk: "GAMES_TOTAL" },
        UpdateExpression: "ADD #count :incr",
        ExpressionAttributeNames: { "#count": "count" },
        ExpressionAttributeValues: { ":incr": 1 },
      })
    );
  }

  async recordGameCompleted(durationMs: number): Promise<void> {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { pk: STATS_PK, sk: "GAMES_COMPLETED" },
        UpdateExpression: "ADD #count :incrCount, #totalMs :incrMs",
        ExpressionAttributeNames: { "#count": "count", "#totalMs": "totalDurationMs" },
        ExpressionAttributeValues: { ":incrCount": 1, ":incrMs": durationMs },
      })
    );
  }

  private async getGamesTotal(): Promise<number> {
    const res = await ddb.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { pk: STATS_PK, sk: "GAMES_TOTAL" } })
    );

    return (res.Item?.count as number | undefined) ?? 0;
  }

  private async getGamesCompleted(): Promise<{ count: number; totalDurationMs: number }> {
    const res = await ddb.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { pk: STATS_PK, sk: "GAMES_COMPLETED" } })
    );

    return {
      count: (res.Item?.count as number | undefined) ?? 0,
      totalDurationMs: (res.Item?.totalDurationMs as number | undefined) ?? 0,
    };
  }

  async getStats(): Promise<ImposterStats> {
    const [gamesPlayedTotal, completed] = await Promise.all([
      this.getGamesTotal(),
      this.getGamesCompleted(),
    ]);

    return {
      gamesPlayedTotal,
      gamesCompletedTotal: completed.count,
      avgGameDurationMs:
        completed.count > 0 ? Math.round((completed.totalDurationMs / completed.count) * 10) / 10 : 0,
    };
  }
}
