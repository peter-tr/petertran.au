import { generateGameId, type GameRecord } from "./game";
import { createImposterResolvers } from "./resolvers";

// In-memory stand-in for the DynamoDB game store - fine for local dev, where
// state doesn't need to survive a server restart.
const devGames = new Map<string, GameRecord>();

export const devResolvers = createImposterResolvers({
  getGame: async (gameId) => devGames.get(gameId) ?? null,
  saveGame: async (game) => {
    devGames.set(game.gameId, game);
  },
  createGame: async (build) => {
    let gameId = generateGameId();
    while (devGames.has(gameId)) gameId = generateGameId();
    const game = build(gameId);
    devGames.set(gameId, game);
    return game;
  },
});
