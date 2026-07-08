// Pure game logic for the Imposter party game - storage-agnostic so both the
// real (DynamoDB-backed) and dev (in-memory) resolvers can share it.

import { randomUUID } from "node:crypto";
import { WORD_CATEGORIES, findWordCategory, randomPair } from "./words";
import { generateAiWordPair } from "./ai";

export type ImposterPhase = "REVEAL" | "DISCUSSION" | "RESULTS";
export type WordSource = "BUILTIN" | "AI";

export interface GamePlayerRecord {
  id: string;
  name: string;
  hasRevealed: boolean;
}

export interface GameRecord {
  gameId: string;
  categoryLabel: string;
  hintEnabled: boolean;
  phase: ImposterPhase;
  players: GamePlayerRecord[];
  imposterIndexes: number[];
  civilianWord: string;
  // Null when hintEnabled is false - imposters get no word at all, only
  // told that they're the imposter.
  imposterWord: string | null;
  createdAt: string;
}

export interface PublicGame {
  gameId: string;
  categoryLabel: string;
  hintEnabled: boolean;
  phase: ImposterPhase;
  players: GamePlayerRecord[];
  imposterPlayerIds: string[] | null;
  civilianWord: string | null;
  imposterWord: string | null;
}

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 12;
const MAX_CUSTOM_CATEGORY_LENGTH = 60;

// Excludes 0/O/1/I to stay unambiguous when read aloud or typed in by hand.
const GAME_ID_CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const GAME_ID_LENGTH = 5;

export function generateGameId(): string {
  let id = "";
  for (let i = 0; i < GAME_ID_LENGTH; i++) {
    id += GAME_ID_CHARS[Math.floor(Math.random() * GAME_ID_CHARS.length)];
  }
  return id;
}

export function listCategories(): { id: string; label: string }[] {
  return WORD_CATEGORIES.map((c) => ({ id: c.id, label: c.label }));
}

// The largest imposter count that still leaves at least two players sharing
// the civilian word - otherwise there's no "everyone but one" to blend into.
export function maxImposterCount(playerCount: number): number {
  return Math.max(1, playerCount - 2);
}

function pickImposterIndexes(playerCount: number, imposterCount: number): number[] {
  const indexes = Array.from({ length: playerCount }, (_, i) => i);
  for (let i = indexes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indexes[i], indexes[j]] = [indexes[j], indexes[i]];
  }
  return indexes.slice(0, imposterCount);
}

export interface NewGameOptions {
  wordSource: WordSource;
  categoryId?: string;
  customCategory?: string;
  playerNames: string[];
  imposterCount?: number;
  hintEnabled?: boolean;
}

// Builds everything about a new game except its gameId, so the caller can
// retry id allocation on collision without re-running (possibly AI-backed)
// word selection.
export async function buildNewGameContent(
  options: NewGameOptions,
  sourceIp: string | undefined
): Promise<Omit<GameRecord, "gameId">> {
  const names = options.playerNames.map((n) => n.trim()).filter(Boolean);
  if (names.length < MIN_PLAYERS || names.length > MAX_PLAYERS) {
    throw new Error(`Imposter needs between ${MIN_PLAYERS} and ${MAX_PLAYERS} players.`);
  }

  const imposterCount = options.imposterCount ?? 1;
  const maxImposters = maxImposterCount(names.length);
  if (imposterCount < 1 || imposterCount > maxImposters) {
    throw new Error(`With ${names.length} players, choose between 1 and ${maxImposters} imposters.`);
  }

  const hintEnabled = options.hintEnabled ?? true;
  const customCategory = options.customCategory?.trim();
  if (customCategory && customCategory.length > MAX_CUSTOM_CATEGORY_LENGTH) {
    throw new Error(`Keep the custom category under ${MAX_CUSTOM_CATEGORY_LENGTH} characters.`);
  }

  let civilianWord: string;
  let imposterWord: string;
  let categoryLabel: string;

  if (options.wordSource === "AI") {
    const pair = await generateAiWordPair(customCategory, sourceIp);
    civilianWord = pair.civilian;
    imposterWord = pair.imposter;
    // Named by the model itself rather than echoing the user's input verbatim
    // - it describes the pair actually picked, which is what helps players
    // during discussion, the same way a built-in category name would.
    categoryLabel = pair.category;
  } else {
    if (!options.categoryId) throw new Error("A category is required for built-in word pairs.");
    const category = findWordCategory(options.categoryId);
    if (!category) throw new Error(`Unknown category "${options.categoryId}".`);
    const pair = randomPair(category);
    civilianWord = pair.civilian;
    imposterWord = pair.imposter;
    categoryLabel = category.label;
  }

  const players: GamePlayerRecord[] = names.map((name) => ({ id: randomUUID(), name, hasRevealed: false }));
  const imposterIndexes = pickImposterIndexes(players.length, imposterCount);

  return {
    phase: "REVEAL",
    players,
    imposterIndexes,
    civilianWord,
    imposterWord: hintEnabled ? imposterWord : null,
    hintEnabled,
    categoryLabel,
    createdAt: new Date().toISOString(),
  };
}

// Withholds the word pair and imposter identity until RESULTS, so polling
// this mid-game can't spoil it for anyone glancing at the network tab.
export function toPublicGame(game: GameRecord): PublicGame {
  const revealed = game.phase === "RESULTS";
  return {
    gameId: game.gameId,
    categoryLabel: game.categoryLabel,
    hintEnabled: game.hintEnabled,
    phase: game.phase,
    players: game.players,
    imposterPlayerIds: revealed ? game.imposterIndexes.map((i) => game.players[i].id) : null,
    civilianWord: revealed ? game.civilianWord : null,
    imposterWord: revealed ? game.imposterWord : null,
  };
}

export interface RevealOutcome {
  game: GameRecord;
  word: string | null;
  isImposter: boolean;
}

export function applyReveal(game: GameRecord, playerId: string): RevealOutcome {
  if (game.phase !== "REVEAL") throw new Error("This game isn't in its reveal phase anymore.");

  const index = game.players.findIndex((p) => p.id === playerId);
  if (index === -1) throw new Error("That player isn't in this game.");
  if (game.players[index].hasRevealed) throw new Error("This player has already revealed their word.");

  const isImposter = game.imposterIndexes.includes(index);
  const word = isImposter ? game.imposterWord : game.civilianWord;

  const players = game.players.map((p, i) => (i === index ? { ...p, hasRevealed: true } : p));
  const done = players.every((p) => p.hasRevealed);

  const updated: GameRecord = {
    ...game,
    players,
    phase: done ? "DISCUSSION" : "REVEAL",
  };

  return { game: updated, word, isImposter };
}

export function applyRevealImposter(game: GameRecord): GameRecord {
  if (game.phase !== "DISCUSSION") {
    throw new Error("The imposter can only be revealed after everyone's had their turn.");
  }
  return { ...game, phase: "RESULTS" };
}
