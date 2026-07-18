// GraphQL client for the Imposter game - talks to its own Lambda/endpoint,
// entirely separate from the resume site's API (see ../../../portfolio/lib/graphql.ts).
// Kept in its own module so this game never shares a schema, endpoint, or
// query surface with the portfolio.

import { createGraphQLClient } from "../../../shared/graphqlClient";
import { ImposterDifficulty, ImposterPhase, ImposterWordSource } from "./api-schema-types.generated";
import type {
  CreateImposterGameMutation,
  CreateImposterGameMutationVariables,
  ImposterCategoriesQuery,
  ImposterGameFieldsFragment,
  ImposterGameStateQuery,
  ImposterStatsQueryQuery,
  LiveImposterGamesQuery,
  RevealImposterMutation,
  RevealImposterWordMutation,
} from "./api.generated";

const ENDPOINT = import.meta.env.VITE_IMPOSTER_GRAPHQL_ENDPOINT as string | undefined;

export const runImposterQuery = createGraphQLClient(ENDPOINT, "VITE_IMPOSTER_GRAPHQL_ENDPOINT");

export { ImposterPhase, ImposterWordSource, ImposterDifficulty };

export type ImposterCategory = ImposterCategoriesQuery["imposterCategories"][number];

export type ImposterPlayer = ImposterGameFieldsFragment["players"][number];

export type ImposterGame = ImposterGameFieldsFragment;

const IMPOSTER_GAME_FIELDS = /* GraphQL */ `
  fragment ImposterGameFields on ImposterGame {
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
  }
`;

export const IMPOSTER_CATEGORIES_QUERY = /* GraphQL */ `
  query ImposterCategories {
    imposterCategories {
      id
      label
    }
  }
`;

export type ImposterCategoriesResult = ImposterCategoriesQuery;

export const IMPOSTER_GAME_QUERY = /* GraphQL */ `
  query ImposterGameState($gameId: String!) {
    imposterGame(gameId: $gameId) {
      ...ImposterGameFields
    }
  }
  ${IMPOSTER_GAME_FIELDS}
`;

export type ImposterGameResult = ImposterGameStateQuery;

export const LIVE_IMPOSTER_GAMES_QUERY = /* GraphQL */ `
  query LiveImposterGames {
    liveImposterGames {
      ...ImposterGameFields
    }
  }
  ${IMPOSTER_GAME_FIELDS}
`;

export type LiveImposterGamesResult = LiveImposterGamesQuery;

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
      ...ImposterGameFields
    }
  }
  ${IMPOSTER_GAME_FIELDS}
`;

export type CreateImposterGameVariables = CreateImposterGameMutationVariables;

export type CreateImposterGameResult = CreateImposterGameMutation;

export const REVEAL_IMPOSTER_WORD_MUTATION = /* GraphQL */ `
  mutation RevealImposterWord($gameId: String!, $playerId: String!) {
    revealImposterWord(gameId: $gameId, playerId: $playerId) {
      word
      isImposter
      game {
        ...ImposterGameFields
      }
    }
  }
  ${IMPOSTER_GAME_FIELDS}
`;

export type RevealImposterWordResult = RevealImposterWordMutation;

export const REVEAL_IMPOSTER_MUTATION = /* GraphQL */ `
  mutation RevealImposter($gameId: String!) {
    revealImposter(gameId: $gameId) {
      ...ImposterGameFields
    }
  }
  ${IMPOSTER_GAME_FIELDS}
`;

export type RevealImposterResult = RevealImposterMutation;

export type ImposterStats = ImposterStatsQueryQuery["imposterStats"];

export const IMPOSTER_STATS_QUERY = /* GraphQL */ `
  query ImposterStatsQuery {
    imposterStats {
      gamesPlayedTotal
      gamesCompletedTotal
      avgGameDurationMs
    }
  }
`;

export type ImposterStatsResult = ImposterStatsQueryQuery;
