import { GetCommand, UpdateCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME } from "../../lib/ddb";
import type { ImposterDailyCount, ImposterStats } from "./game";

// All-time, anonymized usage stats for the game - counters and day-bucketed
// totals only, never individual games/players (see recentGames.ts on the
// frontend for why: a public "list of games" would expose other people's
// in-progress sessions and player names).

const STATS_PK = "STATS";
const GAMES_BY_DAY_PREFIX = "GAMES_BY_DAY#";
const CHART_WINDOW_DAYS = 30;

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function recordGameCreated(): Promise<void> {
  const day = dayKey(new Date());
  await Promise.all([
    ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { pk: STATS_PK, sk: "GAMES_TOTAL" },
        UpdateExpression: "ADD #count :incr",
        ExpressionAttributeNames: { "#count": "count" },
        ExpressionAttributeValues: { ":incr": 1 },
      })
    ),
    ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { pk: STATS_PK, sk: `${GAMES_BY_DAY_PREFIX}${day}` },
        UpdateExpression: "ADD #count :incr",
        ExpressionAttributeNames: { "#count": "count" },
        ExpressionAttributeValues: { ":incr": 1 },
      })
    ),
  ]);
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
  const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: STATS_PK, sk: "GAMES_TOTAL" } }));
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

async function getGamesByDay(): Promise<ImposterDailyCount[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":pk": STATS_PK, ":prefix": GAMES_BY_DAY_PREFIX },
    })
  );

  const counts = new Map<string, number>();
  for (const item of res.Items ?? []) {
    const day = (item.sk as string).slice(GAMES_BY_DAY_PREFIX.length);
    counts.set(day, (item.count as number | undefined) ?? 0);
  }

  const days: ImposterDailyCount[] = [];
  for (let i = CHART_WINDOW_DAYS - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    days.push({ timestamp: d.toISOString(), count: counts.get(dayKey(d)) ?? 0 });
  }
  return days;
}

export async function getImposterStats(): Promise<ImposterStats> {
  const [gamesPlayedTotal, completed, gamesByDay] = await Promise.all([
    getGamesTotal(),
    getGamesCompleted(),
    getGamesByDay(),
  ]);

  return {
    gamesPlayedTotal,
    gamesCompletedTotal: completed.count,
    avgGameDurationMs:
      completed.count > 0 ? Math.round((completed.totalDurationMs / completed.count) * 10) / 10 : 0,
    gamesByDay,
  };
}
