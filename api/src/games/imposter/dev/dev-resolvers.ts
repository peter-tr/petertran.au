import { generateGameId, type GameRecord } from "../lib/game";
import { createImposterResolvers } from "../resolvers/resolvers";

// In-memory stand-in for the DynamoDB game store - fine for local dev, where
// state doesn't need to survive a server restart.
const devGames = new Map<string, GameRecord>();

// Same for usage stats - a handful of counters, just enough to see the panel
// populated during local dev.
let devGamesTotal = 0;
let devGamesCompleted = 0;
let devTotalDurationMs = 0;

export const devResolvers = createImposterResolvers(
  {
    getGame: async (gameId) => devGames.get(gameId) ?? null,
    listLiveGames: async () =>
      Array.from(devGames.values())
        .filter((g) => g.phase !== "RESULTS")
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
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
  },
  {
    recordGameCreated: async () => {
      devGamesTotal += 1;
    },
    recordGameCompleted: async (durationMs) => {
      devGamesCompleted += 1;
      devTotalDurationMs += durationMs;
    },
    getStats: async () => ({
      gamesPlayedTotal: devGamesTotal,
      gamesCompletedTotal: devGamesCompleted,
      avgGameDurationMs: devGamesCompleted > 0 ? devTotalDurationMs / devGamesCompleted : 0,
    }),
  }
);
