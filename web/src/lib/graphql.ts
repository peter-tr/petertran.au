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
      currentlyInto
      funFact
    }
  }
`;

export const HERO_QUERY = /* GraphQL */ `
  query Hero {
    person {
      name
    }
    experience {
      role
      company
      isCurrent
    }
  }
`;

export interface HeroQueryResult {
  person: { name: string };
  experience: { role: string; company: string; isCurrent: boolean }[];
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
        errorsLast24h
        aiQueriesTotal
        operations {
          name
          count
          avgDurationMs
        }
        operationsLast3Days {
          name
          count
          avgDurationMs
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
      errorsLast24h: number;
      aiQueriesTotal: number;
      operations: OperationStat[];
      operationsLast3Days: OperationStat[];
      requestsByHour: HourlyCount[];
    };
  };
}
