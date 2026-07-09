// GraphQL client for the Imposter game - talks to its own Lambda/endpoint,
// entirely separate from the resume site's API (see ../../lib/graphql.ts).
// Kept in its own module so this game never shares a schema, endpoint, or
// query surface with the portfolio.

const ENDPOINT = import.meta.env.VITE_IMPOSTER_GRAPHQL_ENDPOINT as string | undefined;

export class ImposterRequestError extends Error {}

export async function runImposterQuery<T = unknown>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  if (!ENDPOINT) {
    throw new ImposterRequestError("VITE_IMPOSTER_GRAPHQL_ENDPOINT is not configured.");
  }

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new ImposterRequestError(`Request failed with status ${res.status}`);
  }

  const json = await res.json();

  if (json.errors?.length) {
    throw new ImposterRequestError(json.errors.map((e: { message: string }) => e.message).join("; "));
  }

  return json.data as T;
}

export type ImposterPhase = "REVEAL" | "DISCUSSION" | "RESULTS";
export type ImposterWordSource = "BUILTIN" | "AI";

export interface ImposterCategory {
  id: string;
  label: string;
}

export interface ImposterPlayer {
  id: string;
  name: string;
  hasRevealed: boolean;
}

export interface ImposterGame {
  gameId: string;
  categoryLabel: string;
  hintEnabled: boolean;
  phase: ImposterPhase;
  players: ImposterPlayer[];
  imposterPlayerIds: string[] | null;
  civilianWord: string | null;
  imposterWord: string | null;
}

const IMPOSTER_GAME_FIELDS = /* GraphQL */ `
  gameId
  categoryLabel
  hintEnabled
  phase
  players {
    id
    name
    hasRevealed
  }
  imposterPlayerIds
  civilianWord
  imposterWord
`;

export const IMPOSTER_CATEGORIES_QUERY = /* GraphQL */ `
  query ImposterCategories {
    imposterCategories {
      id
      label
    }
  }
`;

export interface ImposterCategoriesResult {
  imposterCategories: ImposterCategory[];
}

export const IMPOSTER_GAME_QUERY = /* GraphQL */ `
  query ImposterGameState($gameId: String!) {
    imposterGame(gameId: $gameId) {
      ${IMPOSTER_GAME_FIELDS}
    }
  }
`;

export interface ImposterGameResult {
  imposterGame: ImposterGame | null;
}

export const CREATE_IMPOSTER_GAME_MUTATION = /* GraphQL */ `
  mutation CreateImposterGame(
    $wordSource: ImposterWordSource!
    $categoryId: String
    $customCategory: String
    $playerNames: [String!]!
    $imposterCount: Int
    $hintEnabled: Boolean
  ) {
    createImposterGame(
      wordSource: $wordSource
      categoryId: $categoryId
      customCategory: $customCategory
      playerNames: $playerNames
      imposterCount: $imposterCount
      hintEnabled: $hintEnabled
    ) {
      ${IMPOSTER_GAME_FIELDS}
    }
  }
`;

export interface CreateImposterGameVariables {
  wordSource: ImposterWordSource;
  categoryId?: string | null;
  customCategory?: string | null;
  playerNames: string[];
  imposterCount?: number;
  hintEnabled?: boolean;
}

export interface CreateImposterGameResult {
  createImposterGame: ImposterGame;
}

export const REVEAL_IMPOSTER_WORD_MUTATION = /* GraphQL */ `
  mutation RevealImposterWord($gameId: String!, $playerId: String!) {
    revealImposterWord(gameId: $gameId, playerId: $playerId) {
      word
      isImposter
      game {
        ${IMPOSTER_GAME_FIELDS}
      }
    }
  }
`;

export interface RevealImposterWordResult {
  revealImposterWord: { word: string | null; isImposter: boolean; game: ImposterGame };
}

export const REVEAL_IMPOSTER_MUTATION = /* GraphQL */ `
  mutation RevealImposter($gameId: String!) {
    revealImposter(gameId: $gameId) {
      ${IMPOSTER_GAME_FIELDS}
    }
  }
`;

export interface RevealImposterResult {
  revealImposter: ImposterGame;
}

export interface ImposterDailyCount {
  timestamp: string;
  count: number;
}

export interface ImposterStats {
  gamesPlayedTotal: number;
  gamesCompletedTotal: number;
  avgGameDurationMs: number;
  gamesByDay: ImposterDailyCount[];
}

export const IMPOSTER_STATS_QUERY = /* GraphQL */ `
  query ImposterStatsQuery {
    imposterStats {
      gamesPlayedTotal
      gamesCompletedTotal
      avgGameDurationMs
      gamesByDay {
        timestamp
        count
      }
    }
  }
`;

export interface ImposterStatsResult {
  imposterStats: ImposterStats;
}
