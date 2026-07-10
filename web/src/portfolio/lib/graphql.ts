import { createGraphQLClient } from "../../shared/graphqlClient";

export const ENDPOINT = import.meta.env.VITE_GRAPHQL_ENDPOINT as string | undefined;

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
    }
    experience(currentOnly: true) {
      role
      company
    }
  }
`;

export interface HeroQueryResult {
  person: { name: string };
  experience: { role: string; company: string }[];
}

export const SEND_MESSAGE_MUTATION = /* GraphQL */ `
  mutation SendMessage($input: ContactInput!) {
    sendMessage(input: $input) {
      success
      message
    }
  }
`;

export interface SendMessageResult {
  sendMessage: { success: boolean; message: string };
}

export const GENERATE_QUERY_QUERY = /* GraphQL */ `
  query GenerateQuery($prompt: String!) {
    meta {
      generateQuery(prompt: $prompt) {
        query
        message
      }
    }
  }
`;

export interface GenerateQueryResult {
  meta: { generateQuery: { query: string | null; message: string | null } };
}

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

export interface OperationStat {
  name: string;
  count: number;
  avgDurationMs: number;
  lastQuery: string | null;
  lastVariables: string | null;
  lastTraceId: string | null;
}

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

export interface TraceSegment {
  name: string;
  startOffsetMs: number;
  durationMs: number;
}

export interface TraceBreakdownResult {
  meta: { traceBreakdown: TraceSegment[] };
}

// Deliberately its own tiny query rather than reusing SYSTEM_STATS_QUERY:
// systemStats' resolver does a batch of CloudWatch/DynamoDB work regardless
// of which of its fields are actually selected, and Footer renders on every
// page - these cost fields are cheap (DynamoDB-cached) precisely because
// they're kept as their own top-level Meta fields, not members of SystemStats.
export const FOOTER_QUERY = /* GraphQL */ `
  query Footer {
    meta {
      awsCostUsd
      anthropicCostUsd
      totalCostUsd
    }
  }
`;

export interface FooterQueryResult {
  meta: { awsCostUsd: number; anthropicCostUsd: number; totalCostUsd: number };
}

export interface DailyCount {
  timestamp: string;
  count: number;
}

export interface SystemStatsResult {
  meta: {
    systemStats: {
      requestsTotal: number;
      avgDurationMs: number;
      aiQueriesTotal: number;
      uniqueVisitorsTotal: number;
      operations: OperationStat[];
      operationsLast30Days: OperationStat[];
      requestsByDay: DailyCount[];
    };
  };
}
