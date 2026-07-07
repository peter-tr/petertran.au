export const ENDPOINT = import.meta.env.VITE_GRAPHQL_ENDPOINT as string | undefined;

export class GraphQLRequestError extends Error {}

export async function runQuery<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T> {
  if (!ENDPOINT) {
    throw new GraphQLRequestError("VITE_GRAPHQL_ENDPOINT is not configured.");
  }

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new GraphQLRequestError(`Request failed with status ${res.status}`);
  }

  const json = await res.json();

  if (json.errors?.length) {
    throw new GraphQLRequestError(json.errors.map((e: { message: string }) => e.message).join("; "));
  }

  return json.data as T;
}

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
    personal {
      hobbies
      favoriteFoods
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
        requestsLast24h
        avgDurationMs
        aiQueriesTotal
        uniqueVisitors
        operations {
          name
          count
          avgDurationMs
          lastQuery
          lastVariables
          lastTraceId
        }
        operationsLast3Days {
          name
          count
          avgDurationMs
          lastQuery
          lastVariables
          lastTraceId
        }
        requestsByHour {
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

export interface HourlyCount {
  timestamp: string;
  count: number;
}

export interface SystemStatsResult {
  meta: {
    systemStats: {
      requestsLast24h: number;
      avgDurationMs: number;
      aiQueriesTotal: number;
      uniqueVisitors: number;
      operations: OperationStat[];
      operationsLast3Days: OperationStat[];
      requestsByHour: HourlyCount[];
    };
  };
}
