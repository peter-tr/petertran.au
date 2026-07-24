# api-shared

## 1.2.0

### Minor Changes

- 0d1e57a: add multi-user support to pantry: sign in via a new Cognito Hosted UI pool to get a private inventory/shopping list/settings, scoped by `pk`. Anyone not signed in keeps using the existing shared/default pantry unchanged.

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
