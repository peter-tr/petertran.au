# supergraph

## 0.4.0

### Minor Changes

- 503e568: enable GraphOS subgraph metrics, bump Router to 2.16.0, remove ADOT collector

### Patch Changes

- 59d2354: Fix a batch of SonarCloud code-smell findings in supergraph: pin build-router-package.ts's `tar` invocation to an absolute path instead of relying on PATH lookup (S4036), and convert its top-level async-IIFE wrapper to top-level await (S7785).
- Updated dependencies [59d2354]
  - api-shared@1.3.1

## 0.3.0

### Minor Changes

- 2ce0e5b: enable Apollo Sandbox at the supergraph's /graphql endpoint

### Patch Changes

- cfe30d6: enable federated field-level tracing for GraphOS Insights
- 05105be: allow studio.apollographql.com in API Gateway CORS preflight + credentials
- 4066a07: disable homepage when sandbox is enabled [URGENT - crashing cold starts]
- 6540fbe: static router.yaml + per-app GraphOS client names
- e121b6e: correct telemetry.apollo config shape for pinned Router version [URGENT - prod outage]
- 3c08a9c: connect the supergraph Router to Apollo GraphOS for Studio usage reporting

  `SupergraphStack` now resolves `APOLLO_KEY`/`APOLLO_GRAPH_REF` (graph `petertran-au@current`) into the Router Lambda's env at deploy time, the same `secretValue.unsafeUnwrap()` pattern used for the Anthropic keys - Router auto-detects these and starts reporting operation metrics/errors to GraphOS Studio. This is independent of schema composition: Router still resolves the supergraph from the build-time offline-composed file (`--supergraph` in `bootstrap`), so cold-start Init Duration is unaffected.

  `build-router-package.ts`'s generated `router.yaml` also tightens `telemetry.apollo.metrics.usage_reports.batch_processor.scheduled_delay` to `1ms` - Apollo's usage-reporting exporter has its own 5s-default batch flush, separate from the OTLP tracing one already tuned here, and would otherwise sit unflushed when Lambda freezes the execution environment right after the response returns (the same failure mode already hit once for X-Ray traces).

  CI (`build-and-deploy.yml`, `verify.yml`) now publishes all 4 subgraphs to GraphOS on every prod deploy and runs `rover subgraph check` on PRs for any subgraph whose schema changed, via `npx @apollo/rover@0.41.0` rather than a marketplace GitHub Action.

- Updated dependencies [25e3615]
- Updated dependencies [803209b]
- Updated dependencies [7ff6b62]
  - api-shared@1.3.0

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
- Updated dependencies [fce1369]
- Updated dependencies [5e57e8f]
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
