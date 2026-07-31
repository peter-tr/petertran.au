# api-shared

## 1.3.1

### Patch Changes

- 59d2354: Fix a batch of SonarCloud code-smell findings in api-shared: rewrite two backtracking-prone regexes in operation-metrics.ts and cognito-auth.ts to linear equivalents (S8786), and convert http.ts's `ALLOWED_ORIGINS` array to a `Set` (S7776).

## 1.3.0

### Minor Changes

- 7ff6b62: add a pantry settings toggle for the AI command bar's provider (direct Anthropic API or AWS Bedrock) and model tier (Haiku/Sonnet), matching design-studio's existing AiSettings pattern. Extracted the provider/model-ID resolution and Bedrock IAM policy into shared modules (`api-shared/ai-provider`, `infra/lib/shared/bedrock-models.ts`) so design-studio and pantry share one implementation instead of two copies. Price checking (Coles lookups) always stays on the direct Anthropic API, since Bedrock doesn't support the web_search/web_fetch tools it depends on.

### Patch Changes

- 25e3615: apply mechanical SonarCloud fixes across api/web/infra
- 803209b: add named OTel spans around the rate-limit check and pantry's DynamoDB calls

  Application Signals' automatic `aws-sdk` instrumentation only produces a generic `dynamodb.<region>.amazonaws.com:443` span for every DynamoDB call, with no operation or table info surfacing in the trace - real X-Ray traces confirmed a guarded pantry mutation shows several indistinguishable DynamoDB spans, so telling the rate-limit check's `UpdateItem` apart from the resolver's own reads/writes required inferring from call order and timing rather than just reading the trace. `api-shared/tracing`'s new `traceSpan()` wraps a piece of work in a real span via `@opentelemetry/api`'s `trace.getTracer().startActiveSpan()` (safe with no exporter registered, e.g. local dev - unlike the classic X-Ray SDK's `traced()`, no environment guard is needed). The shared rate limiter (`rate-limit-check`, used by pantry/portfolio/imposter) and pantry's `DynamoRepository`/`settings`/`price-sync-status` now use it, so future traces name each call directly (e.g. `ITEM.put`, `SHOPLIST.get`, `settings.get`).

## 1.2.0

### Minor Changes

- fce1369: design-studio AI generation: switch default model from Haiku 4.5 to Sonnet 4.6, add a provider/model picker (direct Anthropic API or AWS Bedrock), and improve the generation prompt with a worked example and margin/alignment/contrast rules
- 0d1e57a: add multi-user support to pantry: sign in via a new Cognito Hosted UI pool to get a private inventory/shopping list/settings, scoped by `pk`. Anyone not signed in keeps using the existing shared/default pantry unchanged.

### Patch Changes

- 5e57e8f: strip the Apollo Router's `__<subgraph>__<index>` suffix from operation names before recording them, so the portfolio SystemStats operations table (and the CloudWatch OperationCount metric for portfolio/pantry/imposter) shows "Footer" instead of "Footer__portfolio__0". The federated query planner renames every subgraph-level operation this way for its own internal tracing, even for single-subgraph queries, which had also silently broken the plugin's IntrospectionQuery/TraceBreakdown/SystemStats ignore list.

## 1.1.3

### Patch Changes

- 0584cff: add CORS headers to actual Lambda responses, not just preflight

## 1.1.2

### Patch Changes

- 2c53dce: propagate X-Ray trace header to subgraph/domain gateway calls
- 9c5b5fd: migrate ApiGatewayStack from HTTP API to REST API for real X-Ray trace propagation

## 1.1.1

### Patch Changes

- 342c866: add Vitest unit test suites across all workspaces

## 1.1.0

### Minor Changes

- a806e6f: add per-operation-count metrics across all GraphQL services

### Patch Changes

- 7c8df31: extend X-Ray tracing to SES, Secrets Manager, Cost Explorer, and zero-trust-lab
