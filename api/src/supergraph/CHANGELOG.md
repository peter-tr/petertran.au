# supergraph

## 0.2.0

### Minor Changes

- e68ec68: restore X-Ray tracing for the Router-based supergraph Lambda

### Patch Changes

- de270ee: add CORS headers to actual GraphQL responses via Router config
- 46d2050: add Design Studio, a mock-Canva editor (MongoDB Atlas-backed)
- b9ee226: replace Node @apollo/gateway with Apollo Router on Lambda
- 176a22f: name the trace service instead of leaving OTel's unknown_service fallback
- 23c171e: fix(pantry): forward the authorization header through the API Gateway CORS allowlist and the supergraph gateway to subgraphs - two separate bugs meant a signed-in pantry request never actually reached the pantry Lambda authenticated: the browser's CORS preflight rejected `authorization` outright (it wasn't in the gateway's `Access-Control-Allow-Headers`), and even past that, `RemoteGraphQLDataSource` doesn't forward the original request's headers to a subgraph on its own - the supergraph handler now copies it from context in `willSendRequest`. Verified against the live deployed API: `ensureAccount`/`me` returned "Not signed in."/`null` for a valid Cognito token before this fix, and the account's own id/email after it.
- 24bdf9e: fix supergraph's build cache never invalidating when a subgraph's schema.graphql changes - `supergraph.generated.ts` is gitignored, so turbo's default `$TURBO_DEFAULT$` input tracking never saw it change, and `dependsOn` alone doesn't make a task's cache key depend on an upstream task's output content. This let a stale composed schema (missing the newly-merged `saveAsTemplate` mutation) ship to production even though CI and the deploy both reported success. Disabling caching for `supergraph#codegen` and `supergraph#build` forces both to always run instead of relying on unreliable cross-package input tracking.
- Updated dependencies [0d1e57a]
  - api-shared@1.2.0

## 0.1.2

### Patch Changes

- Updated dependencies [0584cff]
  - api-shared@1.1.3

## 0.1.1

### Patch Changes

- Updated dependencies [2c53dce]
- Updated dependencies [9c5b5fd]
  - api-shared@1.1.2
