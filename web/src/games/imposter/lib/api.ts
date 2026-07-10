// GraphQL client for the Imposter game - talks to its own Lambda/endpoint,
// entirely separate from the resume site's API (see ../../../portfolio/lib/graphql.ts).
// Kept in its own module so this game never shares a schema, endpoint, or
// query surface with the portfolio.

import { createGraphQLClient } from "../../../shared/graphqlClient";

const ENDPOINT = import.meta.env.VITE_IMPOSTER_GRAPHQL_ENDPOINT as string | undefined;

export const runImposterQuery = createGraphQLClient(ENDPOINT, "VITE_IMPOSTER_GRAPHQL_ENDPOINT");

export type ImposterPhase = "REVEAL" | "DISCUSSION" | "RESULTS";
export type ImposterWordSource = "BUILTIN" | "AI";
export type ImposterDifficulty = "NORMAL" | "HARD";

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
  categoryLabel: string | null;
  hintEnabled: boolean;
  phase: ImposterPhase;
  players: ImposterPlayer[];
  imposterPlayerIds: string[] | null;
  civilianWord: string | null;
  imposterWord: string | null;
  createdAt: string;
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
  createdAt
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

export const LIVE_IMPOSTER_GAMES_QUERY = /* GraphQL */ `
  query LiveImposterGames {
    liveImposterGames {
      ${IMPOSTER_GAME_FIELDS}
    }
  }
`;

export interface LiveImposterGamesResult {
  liveImposterGames: ImposterGame[];
}

export const CREATE_IMPOSTER_GAME_MUTATION = /* GraphQL */ `
  mutation CreateImposterGame(
    $wordSource: ImposterWordSource!
    $categoryId: String
    $customCategory: String
    $playerNames: [String!]!
    $imposterCount: Int
    $hintEnabled: Boolean
    $difficulty: ImposterDifficulty
    $hideCategory: Boolean
  ) {
    createImposterGame(
      wordSource: $wordSource
      categoryId: $categoryId
      customCategory: $customCategory
      playerNames: $playerNames
      imposterCount: $imposterCount
      hintEnabled: $hintEnabled
      difficulty: $difficulty
      hideCategory: $hideCategory
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
  difficulty?: ImposterDifficulty;
  hideCategory?: boolean;
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

export interface ImposterStats {
  gamesPlayedTotal: number;
  gamesCompletedTotal: number;
  avgGameDurationMs: number;
}

export const IMPOSTER_STATS_QUERY = /* GraphQL */ `
  query ImposterStatsQuery {
    imposterStats {
      gamesPlayedTotal
      gamesCompletedTotal
      avgGameDurationMs
    }
  }
`;

export interface ImposterStatsResult {
  imposterStats: ImposterStats;
}
