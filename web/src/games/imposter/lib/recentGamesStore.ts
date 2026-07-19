// Client-side "continue a game" list. There's no login/account system here
// (games are joined purely by a shared 5-character code on one shared
// device), so this is per-browser via localStorage - distinct from
// LiveGames.tsx's server-side liveImposterGames query, which lists every
// room in progress rather than just the ones started on this device.

export interface RecentGame {
  gameId: string;
  categoryLabel: string | null;
  playerNames: string[];
  createdAt: string; // ISO
}

const STORAGE_KEY = "imposter:recent-games";
// Games are kept forever server-side now, so there's no expiry to prune
// against here - just cap how many of your own past games this list shows.
const MAX_ENTRIES = 20;

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
  return readAll().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function addRecentGame(game: RecentGame): void {
  const existing = readAll().filter((g) => g.gameId !== game.gameId);
  writeAll([game, ...existing].slice(0, MAX_ENTRIES));
}

export function removeRecentGame(gameId: string): void {
  writeAll(readAll().filter((g) => g.gameId !== gameId));
}
