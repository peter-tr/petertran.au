# pantry

## 1.6.0

### Minor Changes

- 7ff6b62: add a pantry settings toggle for the AI command bar's provider (direct Anthropic API or AWS Bedrock) and model tier (Haiku/Sonnet), matching design-studio's existing AiSettings pattern. Extracted the provider/model-ID resolution and Bedrock IAM policy into shared modules (`api-shared/ai-provider`, `infra/lib/shared/bedrock-models.ts`) so design-studio and pantry share one implementation instead of two copies. Price checking (Coles lookups) always stays on the direct Anthropic API, since Bedrock doesn't support the web_search/web_fetch tools it depends on.
- 240ddbd: add a stale-while-revalidate cache for the pantry page: it now paints instantly from the last-loaded inventory/shopping list/settings on mount while a fresh copy loads in the background, instead of waiting on the network every visit. Controlled by a new "Instant load" toggle on the pantry settings page (`instantLoadCache` on `PantrySettings`, default on) - the cache is scoped per signed-in account (or the shared/default pantry when signed out) and clears immediately when the toggle is switched off.

### Patch Changes

- cfe30d6: enable federated field-level tracing for GraphOS Insights
- 25e3615: apply mechanical SonarCloud fixes across api/web/infra
- 803209b: add named OTel spans around the rate-limit check and pantry's DynamoDB calls

  Application Signals' automatic `aws-sdk` instrumentation only produces a generic `dynamodb.<region>.amazonaws.com:443` span for every DynamoDB call, with no operation or table info surfacing in the trace - real X-Ray traces confirmed a guarded pantry mutation shows several indistinguishable DynamoDB spans, so telling the rate-limit check's `UpdateItem` apart from the resolver's own reads/writes required inferring from call order and timing rather than just reading the trace. `api-shared/tracing`'s new `traceSpan()` wraps a piece of work in a real span via `@opentelemetry/api`'s `trace.getTracer().startActiveSpan()` (safe with no exporter registered, e.g. local dev - unlike the classic X-Ray SDK's `traced()`, no environment guard is needed). The shared rate limiter (`rate-limit-check`, used by pantry/portfolio/imposter) and pantry's `DynamoRepository`/`settings`/`price-sync-status` now use it, so future traces name each call directly (e.g. `ITEM.put`, `SHOPLIST.get`, `settings.get`).

- Updated dependencies [25e3615]
- Updated dependencies [803209b]
- Updated dependencies [7ff6b62]
  - api-shared@1.3.0

## 1.5.0

### Minor Changes

- 0d1e57a: add multi-user support to pantry: sign in via a new Cognito Hosted UI pool to get a private inventory/shopping list/settings, scoped by `pk`. Anyone not signed in keeps using the existing shared/default pantry unchanged.

### Patch Changes

- 6a16cb9: temporary deploy-timing probe for PC reconcile verification
- 38dfeb2: migrate imposter/design-studio/pantry/portfolio off aws-xray-sdk-core to ADOT auto-instrumentation
- 6f0ae76: fix(pantry): build Lambda bundle as CommonJS instead of ESM to fix ADOT cold-start regression

  ESM auto-instrumentation (import-in-the-middle) under the ADOT/Application
  Signals layer added ~3s to every cold start vs. CommonJS's
  require-in-the-middle - confirmed via live A/B testing against a throwaway
  Lambda with the real bundle, real IAM config, and real GraphQL requests
  (~3.7s ESM vs. ~890ms CJS, consistent across 6 samples). No source changes;
  `api/scripts/build-lambda.ts`'s `buildCjsLambdas()` now builds each entry
  as a bundled CJS file plus a thin unbundled wrapper (working around an
  esbuild/OTel interop bug where non-configurable CJS export getters crash
  require-in-the-middle's monkey-patching).

- 8e2dce8: cut portfolio-graphql cold path latency
- 168cd47: remove pantry PC-reconcile deploy-timing probe
- 4303308: pin internal api-shared dependency by wildcard ("*") instead of an exact version, avoiding an intermittent npm ci resolution conflict against an unrelated public package of the same name
- 30e3720: reduce cold-start latency: lazy-load AI/AWS-SDK-heavy resolver paths, bundle AWS SDK v3 instead of externalizing it
- Updated dependencies [fce1369]
- Updated dependencies [5e57e8f]
- Updated dependencies [0d1e57a]
  - api-shared@1.2.0

## 1.4.1

### Patch Changes

- 0584cff: add CORS headers to actual Lambda responses, not just preflight
- Updated dependencies [0584cff]
  - api-shared@1.1.3

## 1.4.0

### Minor Changes

- 74ea629: Apollo Federation supergraph gateway, prod and test

### Patch Changes

- 518b10d: remove scheduled warmup ping, make PC scheduling per-project
- 9c5b5fd: migrate ApiGatewayStack from HTTP API to REST API for real X-Ray trace propagation
- Updated dependencies [2c53dce]
- Updated dependencies [9c5b5fd]
  - api-shared@1.1.2

## 1.3.0

### Minor Changes

- 8856b38: add Playwright visual e2e tests for portfolio/pantry/imposter

### Patch Changes

- 342c866: add Vitest unit test suites across all workspaces
- Updated dependencies [342c866]
  - api-shared@1.1.1

## 1.2.0

### Minor Changes

- a806e6f: add per-operation-count metrics across all GraphQL services

### Patch Changes

- 3eec52f: class-based conversions across imposter, pantry, portfolio
- 7c8df31: extend X-Ray tracing to SES, Secrets Manager, Cost Explorer, and zero-trust-lab
- Updated dependencies [a806e6f]
- Updated dependencies [7c8df31]
  - api-shared@1.1.0

## 1.1.0

### Minor Changes

- bf58948: auto-generate a changeset from the PR title when one is missing
