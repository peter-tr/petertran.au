// Function URLs sometimes get called with a double slash (e.g. AWS's own
// OIDC-discovery fetch against a base URL that already ends in "/") - collapse
// repeated slashes before route-matching so a stray "//introspect" still
// resolves to "/introspect" instead of 404ing.
export function normalizePath(rawPath: string): string {
  return rawPath.replace(/\/{2,}/g, "/");
}
