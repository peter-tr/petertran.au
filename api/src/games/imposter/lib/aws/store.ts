import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { ddb, TABLE_NAME } from "./ddb";
import { generateGameId, type GameRecord } from "../game";

const LIVE_GAMES_INDEX = "GSI1";
const LIVE_GAMES_PK = "LIVE";

function gameKey(gameId: string) {
  return { pk: `GAME#${gameId}`, sk: "STATE" };
}

// Sparse GSI1 attrs: only present while a game is still joinable/in-progress,
// so listLiveGames() never has to filter out finished games itself, and the
// index doesn't grow unbounded alongside the games-kept-forever base table.
function liveIndexAttrs(game: GameRecord): Record<string, string> {
  return game.phase === "RESULTS" ? {} : { gsi1pk: LIVE_GAMES_PK, gsi1sk: game.createdAt };
}

export async function getGame(gameId: string): Promise<GameRecord | null> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: gameKey(gameId) }));

  return (res.Item?.data as GameRecord | undefined) ?? null;
}

// Newest-first: whoever just started a game is the most likely to still be
// looking for players to join in.
export async function listLiveGames(): Promise<GameRecord[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: LIVE_GAMES_INDEX,
      KeyConditionExpression: "gsi1pk = :pk",
      ExpressionAttributeValues: { ":pk": LIVE_GAMES_PK },
      ScanIndexForward: false,
    })
  );

  return (res.Items ?? []).map((item) => item.data as GameRecord);
}

export async function putGame(game: GameRecord): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { ...gameKey(game.gameId), data: game, ...liveIndexAttrs(game) },
    })
  );
}

// Retries on the rare id collision. Takes a synchronous builder (rather than
// the gameId up front) so any AI word generation already happened once,
// outside this loop, before allocation is attempted.
export async function createGameWithUniqueId(build: (gameId: string) => GameRecord): Promise<GameRecord> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const game = build(generateGameId());
    try {
      await ddb.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: { ...gameKey(game.gameId), data: game, ...liveIndexAttrs(game) },
          ConditionExpression: "attribute_not_exists(pk)",
        })
      );

      return game;
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) continue;
      throw err;
    }
  }
  throw new Error("Couldn't allocate a game code - please try again.");
}
