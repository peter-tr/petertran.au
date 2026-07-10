// Thin fetch-based GraphQL client, factored out because the resume API,
// pantry, and imposter each talk to their own independent Lambda endpoint
// but otherwise send/parse requests identically.

export class GraphQLRequestError extends Error {}

export function createGraphQLClient(endpoint: string | undefined, endpointEnvVar: string) {
  return async function runQuery<T = unknown>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<T> {
    if (!endpoint) {
      throw new GraphQLRequestError(`${endpointEnvVar} is not configured.`);
    }

    const res = await fetch(endpoint, {
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
  };
}
