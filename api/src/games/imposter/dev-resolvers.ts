import { generateGameId, type GameRecord, type ImposterDailyCount } from "./game";
import { createImposterResolvers } from "./resolvers";

// In-memory stand-in for the DynamoDB game store - fine for local dev, where
// state doesn't need to survive a server restart.
const devGames = new Map<string, GameRecord>();

// Same for usage stats - a handful of counters plus one day's worth of
// activity, just enough to see the panel populated during local dev.
let devGamesTotal = 0;
let devGamesCompleted = 0;
let devTotalDurationMs = 0;

function devGamesByDay(): ImposterDailyCount[] {
  const days: ImposterDailyCount[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    days.push({ timestamp: d.toISOString(), count: i === 0 ? devGamesTotal : 0 });
  }
  return days;
}

export const devResolvers = createImposterResolvers(
  {
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
      gamesByDay: devGamesByDay(),
    }),
  }
);
