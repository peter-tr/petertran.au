import type { Context } from "../context";
import {
  applyReveal,
  applyRevealImposter,
  buildNewGameContent,
  listCategories,
  toPublicGame,
  type GameRecord,
  type WordSource,
} from "../lib/game";

export interface ImposterStore {
  getGame(gameId: string): Promise<GameRecord | null>;
  saveGame(game: GameRecord): Promise<void>;
  createGame(build: (gameId: string) => GameRecord): Promise<GameRecord>;
}

async function requireGame(store: ImposterStore, gameId: string): Promise<GameRecord> {
  const game = await store.getGame(gameId);
  if (!game) throw new Error("That game code wasn't found - it may have expired.");
  return game;
}

// Shared resolver logic for both the real (DynamoDB) and dev (in-memory)
// backends - only the storage implementation differs between them.
export function createImposterResolvers(store: ImposterStore) {
  return {
    Query: {
      imposterCategories: () => listCategories(),
      imposterGame: async (_: unknown, args: { gameId: string }) => {
        const game = await store.getGame(args.gameId.toUpperCase());
        return game ? toPublicGame(game) : null;
      },
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
        },
        context: Context
      ) => {
        const content = await buildNewGameContent(args, context.sourceIp);
        const game = await store.createGame((gameId) => ({ ...content, gameId }));
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
        return toPublicGame(updated);
      },
    },
  };
}
