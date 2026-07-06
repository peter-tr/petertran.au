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
