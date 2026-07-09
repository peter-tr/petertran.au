import type { Context } from "../context";
import {
  applyReveal,
  applyRevealImposter,
  buildNewGameContent,
  listCategories,
  toPublicGame,
  type GameRecord,
  type ImposterStats,
  type WordDifficulty,
  type WordSource,
} from "../lib/game";

export interface ImposterStore {
  getGame(gameId: string): Promise<GameRecord | null>;
  saveGame(game: GameRecord): Promise<void>;
  createGame(build: (gameId: string) => GameRecord): Promise<GameRecord>;
}

// Best-effort usage tracking - failures here should never break an actual
// game, so resolvers below swallow (and log) errors from these calls rather
// than letting them fail the mutation.
export interface ImposterStatsTracker {
  recordGameCreated(): Promise<void>;
  recordGameCompleted(durationMs: number): Promise<void>;
  getStats(): Promise<ImposterStats>;
}

async function requireGame(store: ImposterStore, gameId: string): Promise<GameRecord> {
  const game = await store.getGame(gameId);
  if (!game) throw new Error("That game code wasn't found - double check it and try again.");
  return game;
}

// Shared resolver logic for both the real (DynamoDB) and dev (in-memory)
// backends - only the storage/stats implementations differ between them.
export function createImposterResolvers(store: ImposterStore, stats: ImposterStatsTracker) {
  return {
    Query: {
      imposterCategories: () => listCategories(),
      imposterGame: async (_: unknown, args: { gameId: string }) => {
        const game = await store.getGame(args.gameId.toUpperCase());
        return game ? toPublicGame(game) : null;
      },
      imposterStats: () => stats.getStats(),
    },
    Mutation: {
      createImposterGame: async (
        _: unknown,
        args: {
          wordSource: WordSource;
          categoryId?: string;
          customCategory?: string;
          playerNames: string[];
          imposterCount?: number;
          hintEnabled?: boolean;
          difficulty?: WordDifficulty;
          hideCategory?: boolean;
        },
        context: Context
      ) => {
        const content = await buildNewGameContent(args, context.sourceIp);
        const game = await store.createGame((gameId) => ({ ...content, gameId }));
        stats.recordGameCreated().catch((err) => console.error("recordGameCreated failed:", err));
        return toPublicGame(game);
      },
      revealImposterWord: async (_: unknown, args: { gameId: string; playerId: string }) => {
        const game = await requireGame(store, args.gameId.toUpperCase());
        const { game: updated, word, isImposter } = applyReveal(game, args.playerId);
        await store.saveGame(updated);
        return { game: toPublicGame(updated), word, isImposter };
      },
      revealImposter: async (_: unknown, args: { gameId: string }) => {
        const game = await requireGame(store, args.gameId.toUpperCase());
        const updated = applyRevealImposter(game);
        await store.saveGame(updated);
        const durationMs = Date.now() - new Date(game.createdAt).getTime();
        stats
          .recordGameCompleted(durationMs)
          .catch((err) => console.error("recordGameCompleted failed:", err));
        return toPublicGame(updated);
      },
    },
  };
}
