// Thin fetch-based GraphQL client, factored out because the resume API,
// pantry, and imposter each talk to their own independent Lambda endpoint
// but otherwise send/parse requests identically.

import { recordRumError } from "./rum";

export class GraphQLRequestError extends Error {}

// Every query/mutation in this codebase is named (codegen requires it), so
// this reliably finds one. Purely for observability - appended as a query
// string param, which the server ignores - it's what makes RUM's http
// events (and the browser's own Resource Timing entries) distinguishable
// by operation instead of every call showing up as the same bare POST url,
// same trick Apollo Client itself uses for GET requests.
const OPERATION_NAME_PATTERN = /^\s*(?:query|mutation|subscription)\s+([A-Za-z_]\w*)/;

function withOperationName(endpoint: string, query: string): string {
  const name = OPERATION_NAME_PATTERN.exec(query)?.[1];
  if (!name) return endpoint;

  const url = new URL(endpoint);
  url.searchParams.set("opname", name);

  return url.toString();
}

export function createGraphQLClient(
  endpoint: string | undefined,
  endpointEnvVar: string,
  // Only pantry currently supplies this (see pantry/api.ts) - optional so
  // the resume API's and imposter's own createGraphQLClient calls are
  // unaffected. Called fresh on every request, not captured once, since the
  // underlying token can be refreshed/cleared between calls.
  getAuthHeader?: () => Promise<string | undefined>
) {
  return async function runQuery<T = unknown>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<T> {
    if (!endpoint) {
      throw new GraphQLRequestError(`${endpointEnvVar} is not configured.`);
    }

    const authHeader = await getAuthHeader?.();

    const res = await fetch(withOperationName(endpoint, query), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authHeader ? { authorization: authHeader } : {}),
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      const err = new GraphQLRequestError(`Request failed with status ${res.status}`);
      recordRumError(err);
      throw err;
    }

    const json = await res.json();

    if (json.errors?.length) {
      // Apollo Server returns HTTP 200 here, so RUM's automatic fetch
      // instrumentation never sees this as a failure on its own - report it
      // explicitly so GraphQL-level errors aren't invisible in RUM.
      const err = new GraphQLRequestError(json.errors.map((e: { message: string }) => e.message).join("; "));
      recordRumError(err);
      throw err;
    }

    return json.data as T;
  };
}
