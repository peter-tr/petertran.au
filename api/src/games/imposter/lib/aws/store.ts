import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { ddb, TABLE_NAME } from "./ddb";
import { generateGameId, type GameRecord } from "../game";

// Games are short-lived - this just keeps the table tidy rather than
// supporting any real "resume tomorrow" use case.
const GAME_TTL_SECONDS = 24 * 60 * 60;

function gameKey(gameId: string) {
  return { pk: `GAME#${gameId}`, sk: "STATE" };
}

export async function getGame(gameId: string): Promise<GameRecord | null> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: gameKey(gameId) }));
  return (res.Item?.data as GameRecord | undefined) ?? null;
}

export async function putGame(game: GameRecord): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { ...gameKey(game.gameId), data: game, ttl: Math.floor(Date.now() / 1000) + GAME_TTL_SECONDS },
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
          Item: {
            ...gameKey(game.gameId),
            data: game,
            ttl: Math.floor(Date.now() / 1000) + GAME_TTL_SECONDS,
          },
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
