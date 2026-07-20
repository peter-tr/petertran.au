import { afterEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../context";
import type { GameRecord } from "../lib/game";
import { createImposterResolvers, type ImposterStatsTracker, type ImposterStore } from "./resolvers";

function makeGame(overrides: Partial<GameRecord> = {}): GameRecord {
  return {
    gameId: "ABCDE",
    categoryLabel: "Animals",
    hideCategory: false,
    hintEnabled: true,
    phase: "REVEAL",
    players: [
      { id: "p1", name: "Alice", hasRevealed: false },
      { id: "p2", name: "Bob", hasRevealed: false },
      { id: "p3", name: "Cara", hasRevealed: false },
    ],
    imposterIndexes: [1],
    civilianWord: "Cat",
    imposterWord: "Dog",
    createdAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeStore(overrides: Partial<ImposterStore> = {}): ImposterStore {
  return {
    getGame: vi.fn(async () => null),
    listLiveGames: vi.fn(async () => []),
    saveGame: vi.fn(async () => {}),
    createGame: vi.fn(async (build: (gameId: string) => GameRecord) => build("ABCDE")),
    ...overrides,
  };
}

function makeStats(overrides: Partial<ImposterStatsTracker> = {}): ImposterStatsTracker {
  return {
    recordGameCreated: vi.fn(async () => {}),
    recordGameCompleted: vi.fn(async () => {}),
    getStats: vi.fn(async () => ({ gamesPlayedTotal: 0, gamesCompletedTotal: 0, avgGameDurationMs: 0 })),
    ...overrides,
  };
}

const context: Context = {};

describe("createImposterResolvers", () => {
  describe("Query.imposterCategories", () => {
    it("lists the built-in categories", () => {
      const { Query } = createImposterResolvers(makeStore(), makeStats());

      const categories = Query.imposterCategories();

      expect(categories.length).toBeGreaterThan(0);
      expect(categories[0]).toHaveProperty("id");
      expect(categories[0]).toHaveProperty("label");
    });
  });

  describe("Query.imposterGame", () => {
    it("uppercases the gameId before looking it up in the store", async () => {
      const store = makeStore({ getGame: vi.fn(async () => makeGame()) });
      const { Query } = createImposterResolvers(store, makeStats());

      await Query.imposterGame(null, { gameId: "abcde" });

      expect(store.getGame).toHaveBeenCalledWith("ABCDE");
    });

    it("returns null when the game isn't found", async () => {
      const { Query } = createImposterResolvers(makeStore(), makeStats());

      const result = await Query.imposterGame(null, { gameId: "zzzzz" });

      expect(result).toBeNull();
    });

    it("returns the public projection (withholding the word pair mid-game) when found", async () => {
      const store = makeStore({ getGame: vi.fn(async () => makeGame()) });
      const { Query } = createImposterResolvers(store, makeStats());

      const result = await Query.imposterGame(null, { gameId: "ABCDE" });

      expect(result?.gameId).toBe("ABCDE");
      expect(result?.civilianWord).toBeNull();
    });
  });

  describe("Query.liveImposterGames", () => {
    it("returns the public projection of every live game from the store", async () => {
      const store = makeStore({
        listLiveGames: vi.fn(async () => [makeGame(), makeGame({ gameId: "FGHJK" })]),
      });
      const { Query } = createImposterResolvers(store, makeStats());

      const result = await Query.liveImposterGames();

      expect(result.map((g) => g.gameId)).toEqual(["ABCDE", "FGHJK"]);
    });
  });

  describe("Query.imposterStats", () => {
    it("delegates directly to the stats tracker", async () => {
      const stats = makeStats({
        getStats: vi.fn(async () => ({
          gamesPlayedTotal: 5,
          gamesCompletedTotal: 2,
          avgGameDurationMs: 100,
        })),
      });
      const { Query } = createImposterResolvers(makeStore(), stats);

      const result = await Query.imposterStats();

      expect(result).toEqual({ gamesPlayedTotal: 5, gamesCompletedTotal: 2, avgGameDurationMs: 100 });
    });
  });

  describe("Mutation.createImposterGame", () => {
    it("builds the game content, persists it via the store, and records creation stats", async () => {
      const store = makeStore();
      const stats = makeStats();
      const { Mutation } = createImposterResolvers(store, stats);

      const result = await Mutation.createImposterGame(
        null,
        { wordSource: "BUILTIN", categoryId: "animals", playerNames: ["Alice", "Bob", "Cara"] },
        context
      );

      expect(store.createGame).toHaveBeenCalledTimes(1);
      expect(result.gameId).toBe("ABCDE");
      expect(result.phase).toBe("REVEAL");
      expect(stats.recordGameCreated).toHaveBeenCalledTimes(1);
    });

    it("still returns the created game even if recording creation stats fails", async () => {
      const store = makeStore();
      const stats = makeStats({
        recordGameCreated: vi.fn(async () => {
          throw new Error("ddb down");
        }),
      });
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { Mutation } = createImposterResolvers(store, stats);

      const result = await Mutation.createImposterGame(
        null,
        { wordSource: "BUILTIN", categoryId: "animals", playerNames: ["Alice", "Bob", "Cara"] },
        context
      );

      expect(result.gameId).toBe("ABCDE");
      await vi.waitFor(() => expect(consoleErrorSpy).toHaveBeenCalled());
      consoleErrorSpy.mockRestore();
    });

    it("propagates validation errors from the underlying game-building logic (e.g. too few players)", async () => {
      const { Mutation } = createImposterResolvers(makeStore(), makeStats());

      await expect(
        Mutation.createImposterGame(
          null,
          { wordSource: "BUILTIN", categoryId: "animals", playerNames: ["Alice"] },
          context
        )
      ).rejects.toThrow(/between 3 and 12 players/);
    });
  });

  describe("Mutation.revealImposterWord", () => {
    it("throws a friendly error when the game code isn't found", async () => {
      const { Mutation } = createImposterResolvers(makeStore(), makeStats());

      await expect(Mutation.revealImposterWord(null, { gameId: "zzzzz", playerId: "p1" })).rejects.toThrow(
        /wasn't found/
      );
    });

    it("uppercases the gameId, applies the reveal, and persists the updated game", async () => {
      const game = makeGame();
      const store = makeStore({ getGame: vi.fn(async () => game) });
      const { Mutation } = createImposterResolvers(store, makeStats());

      const result = await Mutation.revealImposterWord(null, { gameId: "abcde", playerId: "p1" });

      expect(store.getGame).toHaveBeenCalledWith("ABCDE");
      expect(store.saveGame).toHaveBeenCalledTimes(1);
      expect(result.word).toBe("Cat");
      expect(result.isImposter).toBe(false);
      expect(result.game.gameId).toBe("ABCDE");
    });

    it("reports the imposter's own reveal correctly", async () => {
      const game = makeGame();
      const store = makeStore({ getGame: vi.fn(async () => game) });
      const { Mutation } = createImposterResolvers(store, makeStats());

      const result = await Mutation.revealImposterWord(null, { gameId: "ABCDE", playerId: "p2" });

      expect(result.word).toBe("Dog");
      expect(result.isImposter).toBe(true);
    });
  });

  describe("Mutation.revealImposter", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("throws when the game code isn't found", async () => {
      const { Mutation } = createImposterResolvers(makeStore(), makeStats());

      await expect(Mutation.revealImposter(null, { gameId: "zzzzz" })).rejects.toThrow(/wasn't found/);
    });

    it("advances the game to RESULTS, saves it, and records completion stats with the elapsed duration", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-01T00:05:00.000Z"));

      const game = makeGame({ phase: "DISCUSSION", createdAt: "2024-01-01T00:00:00.000Z" });
      const store = makeStore({ getGame: vi.fn(async () => game) });
      const stats = makeStats();
      const { Mutation } = createImposterResolvers(store, stats);

      const result = await Mutation.revealImposter(null, { gameId: "ABCDE" });

      expect(result.phase).toBe("RESULTS");
      expect(store.saveGame).toHaveBeenCalledTimes(1);
      expect(stats.recordGameCompleted).toHaveBeenCalledWith(5 * 60 * 1000);
    });

    it("still returns the updated game even if recording completion stats fails", async () => {
      const game = makeGame({ phase: "DISCUSSION" });
      const store = makeStore({ getGame: vi.fn(async () => game) });
      const stats = makeStats({
        recordGameCompleted: vi.fn(async () => {
          throw new Error("ddb down");
        }),
      });
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { Mutation } = createImposterResolvers(store, stats);

      const result = await Mutation.revealImposter(null, { gameId: "ABCDE" });

      expect(result.phase).toBe("RESULTS");
      await vi.waitFor(() => expect(consoleErrorSpy).toHaveBeenCalled());
      consoleErrorSpy.mockRestore();
    });
  });
});
