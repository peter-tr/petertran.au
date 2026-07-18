import { createGraphQLClient } from "../../shared/graphqlClient";
import type {
  FooterQuery,
  GenerateQueryQuery,
  HeroQuery,
  SendMessageMutation,
  SystemStatsQuery,
  TraceBreakdownQuery,
} from "./graphql.generated";

// See pantry/api.ts's identical guard for why this optional-chains `env`
// even though Vite always defines it - api/scripts/validate-schemas.ts
// requires this module outside Vite to validate the queries below.
export const ENDPOINT = import.meta.env?.VITE_GRAPHQL_ENDPOINT as string | undefined;

export const runQuery = createGraphQLClient(ENDPOINT, "VITE_GRAPHQL_ENDPOINT");

export const RESUME_QUERY = /* GraphQL */ `
  query Resume {
    person {
      name
      email
      location
      clearance
      links {
        label
        url
      }
    }
    education {
      institution
      degree
      location
      startDate
      endDate
      honors
    }
    experience {
      company
      role
      location
      startDate
      endDate
      isCurrent
      summary
      highlights
    }
    projects {
      name
      stack
      description
      url
    }
    skills {
      category
      items
    }
    programs {
      name
      organization
      description
      startDate
      endDate
    }
    interests {
      hobbies
      favoriteFoods
      favoriteShows
    }
  }
`;

export const HERO_QUERY = /* GraphQL */ `
  query Hero {
    person {
      name
      links {
        label
        url
      }
    }
    experience(currentOnly: true) {
      role
      company
    }
  }
`;

export type HeroQueryResult = HeroQuery;

export const SEND_MESSAGE_MUTATION = /* GraphQL */ `
  mutation SendMessage($input: ContactInput!) {
    sendMessage(input: $input) {
      success
      message
    }
  }
`;

export type SendMessageResult = SendMessageMutation;

export const GENERATE_QUERY_QUERY = /* GraphQL */ `
  query GenerateQuery($prompt: String!) {
    meta {
      generateQuery(prompt: $prompt) {
        query
        message
        answer
      }
    }
  }
`;

export type GenerateQueryResult = GenerateQueryQuery;

export const SYSTEM_STATS_QUERY = /* GraphQL */ `
  query SystemStats {
    meta {
      systemStats {
        requestsTotal
        avgDurationMs
        aiQueriesTotal
        uniqueVisitorsTotal
        operations {
          name
          count
          avgDurationMs
          lastQuery
          lastVariables
          lastTraceId
        }
        operationsLast30Days {
          name
          count
          avgDurationMs
          lastQuery
          lastVariables
          lastTraceId
        }
        requestsByDay {
          timestamp
          count
        }
      }
    }
  }
`;

export type OperationStat = SystemStatsQuery["meta"]["systemStats"]["operations"][number];

export const TRACE_BREAKDOWN_QUERY = /* GraphQL */ `
  query TraceBreakdown($traceId: String!) {
    meta {
      traceBreakdown(traceId: $traceId) {
        name
        startOffsetMs
        durationMs
      }
    }
  }
`;

export type TraceSegment = TraceBreakdownQuery["meta"]["traceBreakdown"][number];

export type TraceBreakdownResult = TraceBreakdownQuery;

// Deliberately its own tiny query rather than reusing SYSTEM_STATS_QUERY:
// systemStats' resolver does a batch of CloudWatch/DynamoDB work regardless
// of which of its fields are actually selected, and Footer renders on every
// page - these cost fields are cheap (DynamoDB-cached) precisely because
// they're kept as their own top-level Meta fields, not members of SystemStats.
export const FOOTER_QUERY = /* GraphQL */ `
  query Footer {
    person {
      email
    }
    meta {
      awsCostUsd
      anthropicCostUsd
      totalCostUsd
    }
  }
`;

export type FooterQueryResult = FooterQuery;

export type DailyCount = SystemStatsQuery["meta"]["systemStats"]["requestsByDay"][number];

export type SystemStatsResult = SystemStatsQuery;
