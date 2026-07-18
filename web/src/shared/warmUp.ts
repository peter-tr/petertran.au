// Fire-and-forget ping so a Lambda's execution environment is already spun
// up by the time a visitor navigates to the feature that actually needs it
// (e.g. warming pantry/imposter from the portfolio home page). `{ __typename
// }` resolves at the GraphQL root without touching any resolver, DynamoDB,
// or Anthropic call - this only pays for Lambda init, nothing else.
// Endpoints are already public with CORS permissive for this site's own
// origin (see pantry-stack.ts / games-stack.ts Function URL config), so this
// needs no backend change and no new surface.
const warmedEndpoints = new Set<string>();

export function warmUp(endpoint: string | undefined): void {
  if (!endpoint || warmedEndpoints.has(endpoint)) return;
  warmedEndpoints.add(endpoint);

  fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "{ __typename }" }),
    keepalive: true,
  }).catch(() => {});
}
