import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME } from "./ddb";
import type { ImposterStats } from "../game";

// All-time, anonymized usage stats for the game - running counters only.
// Individual live games are listed separately via liveImposterGames (see
// ../aws/store.ts's listLiveGames) - these counters stay aggregate-only
// because they're all-time totals, not a way to browse specific sessions.

const STATS_PK = "STATS";

export async function recordGameCreated(): Promise<void> {
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

export async function recordGameCompleted(durationMs: number): Promise<void> {
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

async function getGamesTotal(): Promise<number> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { pk: STATS_PK, sk: "GAMES_TOTAL" } })
  );

  return (res.Item?.count as number | undefined) ?? 0;
}

async function getGamesCompleted(): Promise<{ count: number; totalDurationMs: number }> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { pk: STATS_PK, sk: "GAMES_COMPLETED" } })
  );

  return {
    count: (res.Item?.count as number | undefined) ?? 0,
    totalDurationMs: (res.Item?.totalDurationMs as number | undefined) ?? 0,
  };
}

export async function getImposterStats(): Promise<ImposterStats> {
  const [gamesPlayedTotal, completed] = await Promise.all([getGamesTotal(), getGamesCompleted()]);

  return {
    gamesPlayedTotal,
    gamesCompletedTotal: completed.count,
    avgGameDurationMs:
      completed.count > 0 ? Math.round((completed.totalDurationMs / completed.count) * 10) / 10 : 0,
  };
}
