import { describe, it, expect, beforeEach } from "vitest";
import { addRecentGame, getRecentGames, removeRecentGame, type RecentGame } from "./recentGamesStore";

const STORAGE_KEY = "imposter:recent-games";

function makeGame(overrides: Partial<RecentGame> = {}): RecentGame {
  return {
    gameId: "abcde",
    categoryLabel: "Animals",
    playerNames: ["Alice", "Bob", "Carol"],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("getRecentGames", () => {
  it("returns an empty array when nothing has been stored", () => {
    expect(getRecentGames()).toEqual([]);
  });

  it("returns [] and doesn't throw when storage contains invalid JSON", () => {
    localStorage.setItem(STORAGE_KEY, "{not valid json");

    expect(getRecentGames()).toEqual([]);
  });

  it("returns [] when storage contains valid JSON that isn't an array", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ oops: true }));

    expect(getRecentGames()).toEqual([]);
  });

  it("sorts games newest-createdAt first regardless of storage order", () => {
    const older = makeGame({ gameId: "older", createdAt: "2026-01-01T00:00:00.000Z" });
    const newer = makeGame({ gameId: "newer", createdAt: "2026-06-01T00:00:00.000Z" });
    localStorage.setItem(STORAGE_KEY, JSON.stringify([older, newer]));

    expect(getRecentGames().map((g) => g.gameId)).toEqual(["newer", "older"]);
  });
});

describe("addRecentGame", () => {
  it("persists a game to localStorage so it can be read back", () => {
    const game = makeGame();
    addRecentGame(game);

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual([game]);
    expect(getRecentGames()).toEqual([game]);
  });

  it("adds newly-added games to the front", () => {
    addRecentGame(makeGame({ gameId: "first", createdAt: "2026-01-01T00:00:00.000Z" }));
    addRecentGame(makeGame({ gameId: "second", createdAt: "2026-01-02T00:00:00.000Z" }));

    expect(getRecentGames().map((g) => g.gameId)).toEqual(["second", "first"]);
  });

  it("dedups by gameId, replacing the existing entry rather than adding a duplicate", () => {
    addRecentGame(makeGame({ gameId: "same", categoryLabel: "Old label" }));
    addRecentGame(makeGame({ gameId: "same", categoryLabel: "New label" }));

    const all = getRecentGames();
    expect(all).toHaveLength(1);
    expect(all[0].categoryLabel).toBe("New label");
  });

  it("caps the list at 20 entries, dropping the oldest-inserted first", () => {
    for (let i = 0; i < 25; i++) {
      addRecentGame(
        makeGame({ gameId: `game-${i}`, createdAt: `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z` })
      );
    }

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as RecentGame[];
    expect(stored).toHaveLength(20);
    // Most recently added (game-24) is first; the first five added (game-0..4) fell off.
    expect(stored[0].gameId).toBe("game-24");
    expect(stored.map((g) => g.gameId)).not.toContain("game-0");
    expect(stored.map((g) => g.gameId)).not.toContain("game-4");
    expect(stored.map((g) => g.gameId)).toContain("game-5");
  });
});

describe("removeRecentGame", () => {
  it("removes only the specified game", () => {
    addRecentGame(makeGame({ gameId: "keep" }));
    addRecentGame(makeGame({ gameId: "drop" }));

    removeRecentGame("drop");

    const remainingIds = getRecentGames().map((g) => g.gameId);
    expect(remainingIds).toEqual(["keep"]);
  });

  it("is a no-op when the gameId isn't present", () => {
    addRecentGame(makeGame({ gameId: "keep" }));

    removeRecentGame("does-not-exist");

    expect(getRecentGames().map((g) => g.gameId)).toEqual(["keep"]);
  });
});
