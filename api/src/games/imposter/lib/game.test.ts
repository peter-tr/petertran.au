import { beforeEach, describe, expect, it, vi } from "vitest";

const generateAiWordPair = vi.fn();

// vi.mock calls are hoisted above imports by vitest's transform, so game.ts
// (imported below) picks up this mocked generateAiWordPair instead of ever
// touching the real Anthropic client.
vi.mock("./anthropic/ai", () => ({
  generateAiWordPair: (
    theme: string | undefined,
    difficulty: string,
    sourceIp: string | undefined,
    xraySegment: unknown
  ) => generateAiWordPair(theme, difficulty, sourceIp, xraySegment),
}));

import {
  applyReveal,
  applyRevealImposter,
  buildNewGameContent,
  generateGameId,
  listCategories,
  maxImposterCount,
  toPublicGame,
  type GameRecord,
} from "./game";
import { WORD_CATEGORIES } from "./words";

function samplePlayers(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `Player ${i + 1}`);
}

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

describe("generateGameId", () => {
  it("generates a 5-character id from the unambiguous alphabet (excludes 0/O/1/I)", () => {
    for (let i = 0; i < 200; i++) {
      const id = generateGameId();
      expect(id).toHaveLength(5);
      expect(id).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/);
    }
  });
});

describe("listCategories", () => {
  it("returns id/label pairs for every built-in category", () => {
    expect(listCategories()).toEqual(WORD_CATEGORIES.map((c) => ({ id: c.id, label: c.label })));
  });
});

describe("maxImposterCount", () => {
  it("is playerCount - 2 for larger groups", () => {
    expect(maxImposterCount(5)).toBe(3);
    expect(maxImposterCount(12)).toBe(10);
  });

  it("never goes below 1, even for tiny groups", () => {
    expect(maxImposterCount(3)).toBe(1);
    expect(maxImposterCount(2)).toBe(1);
    expect(maxImposterCount(1)).toBe(1);
  });
});

describe("buildNewGameContent", () => {
  beforeEach(() => {
    generateAiWordPair.mockReset();
  });

  it("rejects fewer than 3 players", async () => {
    await expect(
      buildNewGameContent(
        { wordSource: "BUILTIN", categoryId: "animals", playerNames: samplePlayers(2) },
        undefined,
        undefined
      )
    ).rejects.toThrow(/between 3 and 12 players/);
  });

  it("rejects more than 12 players", async () => {
    await expect(
      buildNewGameContent(
        { wordSource: "BUILTIN", categoryId: "animals", playerNames: samplePlayers(13) },
        undefined,
        undefined
      )
    ).rejects.toThrow(/between 3 and 12 players/);
  });

  it("trims whitespace and drops blank names before counting/validating players", async () => {
    const content = await buildNewGameContent(
      { wordSource: "BUILTIN", categoryId: "animals", playerNames: ["  Alice ", "", "   ", "Bob", "Cara"] },
      undefined,
      undefined
    );
    expect(content.players.map((p) => p.name)).toEqual(["Alice", "Bob", "Cara"]);
  });

  it("rejects an imposterCount above what the player count allows", async () => {
    await expect(
      buildNewGameContent(
        {
          wordSource: "BUILTIN",
          categoryId: "animals",
          playerNames: samplePlayers(3),
          imposterCount: 2, // maxImposterCount(3) === 1
        },
        undefined,
        undefined
      )
    ).rejects.toThrow(/choose between 1 and 1 imposters/);
  });

  it("rejects an imposterCount below 1", async () => {
    await expect(
      buildNewGameContent(
        { wordSource: "BUILTIN", categoryId: "animals", playerNames: samplePlayers(4), imposterCount: 0 },
        undefined,
        undefined
      )
    ).rejects.toThrow(/choose between 1 and/);
  });

  it("requires a categoryId for BUILTIN word source", async () => {
    await expect(
      buildNewGameContent({ wordSource: "BUILTIN", playerNames: samplePlayers(3) }, undefined, undefined)
    ).rejects.toThrow(/category is required/);
  });

  it("rejects an unknown categoryId", async () => {
    await expect(
      buildNewGameContent(
        { wordSource: "BUILTIN", categoryId: "not-a-real-category", playerNames: samplePlayers(3) },
        undefined,
        undefined
      )
    ).rejects.toThrow(/Unknown category/);
  });

  it("rejects a custom category over 60 characters, regardless of word source", async () => {
    await expect(
      buildNewGameContent(
        { wordSource: "AI", customCategory: "x".repeat(61), playerNames: samplePlayers(3) },
        undefined,
        undefined
      )
    ).rejects.toThrow(/under 60 characters/);
    expect(generateAiWordPair).not.toHaveBeenCalled();
  });

  it("builds a BUILTIN game with a word pair from the requested category", async () => {
    const content = await buildNewGameContent(
      { wordSource: "BUILTIN", categoryId: "animals", playerNames: samplePlayers(4) },
      undefined,
      undefined
    );
    const category = WORD_CATEGORIES.find((c) => c.id === "animals")!;

    expect(content.categoryLabel).toBe(category.label);
    expect(category.normalPairs).toContainEqual({
      civilian: content.civilianWord,
      imposter: content.imposterWord,
    });
    expect(content.phase).toBe("REVEAL");
    expect(content.hideCategory).toBe(false);
    expect(content.hintEnabled).toBe(true);
    expect(content.imposterIndexes).toHaveLength(1); // default imposterCount
    expect(content.players).toHaveLength(4);
    expect(new Set(content.players.map((p) => p.id)).size).toBe(4); // unique ids
    expect(content.players.every((p) => p.hasRevealed === false)).toBe(true);
  });

  it("assigns exactly imposterCount unique, in-range imposter indexes", async () => {
    for (let i = 0; i < 20; i++) {
      const content = await buildNewGameContent(
        { wordSource: "BUILTIN", categoryId: "animals", playerNames: samplePlayers(8), imposterCount: 3 },
        undefined,
        undefined
      );
      expect(content.imposterIndexes).toHaveLength(3);
      expect(new Set(content.imposterIndexes).size).toBe(3);
      for (const idx of content.imposterIndexes) {
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(8);
      }
    }
  });

  it("uses HARD pairs when difficulty is HARD", async () => {
    const category = WORD_CATEGORIES.find((c) => c.id === "animals")!;
    const content = await buildNewGameContent(
      { wordSource: "BUILTIN", categoryId: "animals", playerNames: samplePlayers(3), difficulty: "HARD" },
      undefined,
      undefined
    );
    expect(category.hardPairs).toContainEqual({
      civilian: content.civilianWord,
      imposter: content.imposterWord,
    });
  });

  it("hides the imposter word (but not the civilian word) when hintEnabled is false", async () => {
    const content = await buildNewGameContent(
      { wordSource: "BUILTIN", categoryId: "animals", playerNames: samplePlayers(3), hintEnabled: false },
      undefined,
      undefined
    );
    expect(content.imposterWord).toBeNull();
    expect(content.civilianWord).toBeTruthy();
    expect(content.hintEnabled).toBe(false);
  });

  it("uses the AI word source, naming the category from the model's own response rather than the input theme", async () => {
    generateAiWordPair.mockResolvedValueOnce({
      category: "Coffee drinks",
      civilian: "Latte",
      imposter: "Espresso",
    });

    const content = await buildNewGameContent(
      { wordSource: "AI", customCategory: "coffee", playerNames: samplePlayers(3) },
      "1.2.3.4",
      undefined
    );

    expect(generateAiWordPair).toHaveBeenCalledWith("coffee", "NORMAL", "1.2.3.4", undefined);
    expect(content.categoryLabel).toBe("Coffee drinks");
    expect(content.civilianWord).toBe("Latte");
    expect(content.imposterWord).toBe("Espresso");
  });
});

describe("toPublicGame", () => {
  it("withholds the word pair and imposter identity before RESULTS", () => {
    const pub = toPublicGame(makeGame());
    expect(pub.civilianWord).toBeNull();
    expect(pub.imposterWord).toBeNull();
    expect(pub.imposterPlayerIds).toBeNull();
  });

  it("reveals the word pair and imposter identity at RESULTS", () => {
    const pub = toPublicGame(makeGame({ phase: "RESULTS" }));
    expect(pub.civilianWord).toBe("Cat");
    expect(pub.imposterWord).toBe("Dog");
    expect(pub.imposterPlayerIds).toEqual(["p2"]); // imposterIndexes: [1] -> players[1].id
  });

  it("hides the category label pre-results when hideCategory is set", () => {
    const pub = toPublicGame(makeGame({ hideCategory: true }));
    expect(pub.categoryLabel).toBeNull();
  });

  it("reveals the category label at RESULTS even if hideCategory was set", () => {
    const pub = toPublicGame(makeGame({ hideCategory: true, phase: "RESULTS" }));
    expect(pub.categoryLabel).toBe("Animals");
  });

  it("shows the category label pre-results when hideCategory is false", () => {
    const pub = toPublicGame(makeGame({ hideCategory: false, phase: "DISCUSSION" }));
    expect(pub.categoryLabel).toBe("Animals");
  });

  it("always passes through gameId, hintEnabled, phase, players, and createdAt unchanged", () => {
    const game = makeGame();
    const pub = toPublicGame(game);
    expect(pub.gameId).toBe(game.gameId);
    expect(pub.hintEnabled).toBe(game.hintEnabled);
    expect(pub.phase).toBe(game.phase);
    expect(pub.players).toEqual(game.players);
    expect(pub.createdAt).toBe(game.createdAt);
  });
});

describe("applyReveal", () => {
  it("throws when the player isn't in the game", () => {
    expect(() => applyReveal(makeGame(), "not-a-player")).toThrow(/isn't in this game/);
  });

  it("returns the civilian word and isImposter=false for a non-imposter player", () => {
    const { word, isImposter } = applyReveal(makeGame(), "p1");
    expect(word).toBe("Cat");
    expect(isImposter).toBe(false);
  });

  it("returns the imposter word and isImposter=true for the imposter", () => {
    const { word, isImposter } = applyReveal(makeGame(), "p2");
    expect(word).toBe("Dog");
    expect(isImposter).toBe(true);
  });

  it("marks only that player as revealed and keeps the game in REVEAL while others remain", () => {
    const { game } = applyReveal(makeGame(), "p1");
    expect(game.phase).toBe("REVEAL");
    expect(game.players.find((p) => p.id === "p1")?.hasRevealed).toBe(true);
    expect(game.players.find((p) => p.id === "p2")?.hasRevealed).toBe(false);
  });

  it("advances to DISCUSSION once every player has revealed", () => {
    let game = makeGame();
    game = applyReveal(game, "p1").game;
    game = applyReveal(game, "p2").game;
    game = applyReveal(game, "p3").game;
    expect(game.phase).toBe("DISCUSSION");
    expect(game.players.every((p) => p.hasRevealed)).toBe(true);
  });

  it("throws if a not-yet-revealed player tries to reveal outside the REVEAL phase", () => {
    const game = makeGame({ phase: "DISCUSSION" });
    expect(() => applyReveal(game, "p1")).toThrow(/reveal phase/);
  });

  it("lets an already-revealed player replay their word read-only, even after the game moved past REVEAL", () => {
    const game = makeGame({
      phase: "DISCUSSION",
      players: [
        { id: "p1", name: "Alice", hasRevealed: true },
        { id: "p2", name: "Bob", hasRevealed: true },
        { id: "p3", name: "Cara", hasRevealed: true },
      ],
    });

    const outcome = applyReveal(game, "p2");
    expect(outcome.word).toBe("Dog");
    expect(outcome.isImposter).toBe(true);
    expect(outcome.game).toBe(game); // same reference back - no mutation attempted
  });
});

describe("applyRevealImposter", () => {
  it("throws if the game isn't in DISCUSSION yet", () => {
    expect(() => applyRevealImposter(makeGame({ phase: "REVEAL" }))).toThrow(/everyone's had their turn/);
  });

  it("throws if the game is already at RESULTS", () => {
    expect(() => applyRevealImposter(makeGame({ phase: "RESULTS" }))).toThrow(/everyone's had their turn/);
  });

  it("moves the game to RESULTS from DISCUSSION", () => {
    const updated = applyRevealImposter(makeGame({ phase: "DISCUSSION" }));
    expect(updated.phase).toBe("RESULTS");
  });
});
