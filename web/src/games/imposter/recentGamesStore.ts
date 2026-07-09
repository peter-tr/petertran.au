// Client-side "continue a game" list. There's no login/account system here
// (games are joined purely by a shared 5-character code on one shared
// device), so this is deliberately per-browser via localStorage rather than
// a server-side "list games" query -- a public "list all active games"
// endpoint would let any visitor browse other people's in-progress sessions
// and player names, which this game's isolated schema is specifically
// designed to avoid.

export interface RecentGame {
  gameId: string;
  categoryLabel: string;
  playerNames: string[];
  createdAt: string; // ISO
}

const STORAGE_KEY = "imposter:recent-games";
const MAX_ENTRIES = 20;
// Mirrors GAME_TTL_SECONDS in api/src/games/imposter/store.ts -- once a game
// has aged past this, the server has already expired it via DynamoDB TTL, so
// there's no point showing a "Continue" that can only 404.
const GAME_TTL_MS = 24 * 60 * 60 * 1000;

function readAll(): RecentGame[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentGame[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function writeAll(games: RecentGame[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(games));
  } catch {
    // Storage unavailable (private browsing, quota, etc.) -- the "continue"
    // list is a convenience, not a requirement, so fail silently.
  }
}

export function getRecentGames(): RecentGame[] {
  const now = Date.now();
  const fresh = readAll().filter((g) => now - new Date(g.createdAt).getTime() < GAME_TTL_MS);
  return fresh.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function addRecentGame(game: RecentGame): void {
  const existing = readAll().filter((g) => g.gameId !== game.gameId);
  writeAll([game, ...existing].slice(0, MAX_ENTRIES));
}

export function removeRecentGame(gameId: string): void {
  writeAll(readAll().filter((g) => g.gameId !== gameId));
}
