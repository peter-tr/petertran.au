# pantry

## 1.5.0

### Minor Changes

- 0d1e57a: add multi-user support to pantry: sign in via a new Cognito Hosted UI pool to get a private inventory/shopping list/settings, scoped by `pk`. Anyone not signed in keeps using the existing shared/default pantry unchanged.

### Patch Changes

- 6a16cb9: temporary deploy-timing probe for PC reconcile verification
- 38dfeb2: migrate imposter/design-studio/pantry/portfolio off aws-xray-sdk-core to ADOT auto-instrumentation
- 8e2dce8: cut portfolio-graphql cold path latency
- 168cd47: remove pantry PC-reconcile deploy-timing probe
- 4303308: pin internal api-shared dependency by wildcard ("*") instead of an exact version, avoiding an intermittent npm ci resolution conflict against an unrelated public package of the same name
- 30e3720: reduce cold-start latency: lazy-load AI/AWS-SDK-heavy resolver paths, bundle AWS SDK v3 instead of externalizing it
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
