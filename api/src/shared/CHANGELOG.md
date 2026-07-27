# api-shared

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
