import { generateGameId, type GameRecord, type ImposterStats } from "../lib/game";
import {
  createImposterResolvers,
  type ImposterStore,
  type ImposterStatsTracker,
} from "../resolvers/resolvers";

// In-memory stand-in for the DynamoDB game store - fine for local dev, where
// state doesn't need to survive a server restart.
class InMemoryImposterStore implements ImposterStore {
  private games = new Map<string, GameRecord>();

  async getGame(gameId: string): Promise<GameRecord | null> {
    return this.games.get(gameId) ?? null;
  }

  async listLiveGames(): Promise<GameRecord[]> {
    return Array.from(this.games.values())
      .filter((g) => g.phase !== "RESULTS")
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async saveGame(game: GameRecord): Promise<void> {
    this.games.set(game.gameId, game);
  }

  async createGame(build: (gameId: string) => GameRecord): Promise<GameRecord> {
    let gameId = generateGameId();
    while (this.games.has(gameId)) gameId = generateGameId();

    const game = build(gameId);
    this.games.set(gameId, game);

    return game;
  }
}

// Same for usage stats - a handful of counters, just enough to see the panel
// populated during local dev.
class InMemoryImposterStatsTracker implements ImposterStatsTracker {
  private gamesTotal = 0;
  private gamesCompleted = 0;
  private totalDurationMs = 0;

  async recordGameCreated(): Promise<void> {
    this.gamesTotal += 1;
  }

  async recordGameCompleted(durationMs: number): Promise<void> {
    this.gamesCompleted += 1;
    this.totalDurationMs += durationMs;
  }

  async getStats(): Promise<ImposterStats> {
    return {
      gamesPlayedTotal: this.gamesTotal,
      gamesCompletedTotal: this.gamesCompleted,
      avgGameDurationMs: this.gamesCompleted > 0 ? this.totalDurationMs / this.gamesCompleted : 0,
    };
  }
}

export const devResolvers = createImposterResolvers(
  new InMemoryImposterStore(),
  new InMemoryImposterStatsTracker()
);
