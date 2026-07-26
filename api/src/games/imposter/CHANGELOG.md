# imposter

## 1.3.2

### Patch Changes

- 38dfeb2: migrate imposter/design-studio/pantry/portfolio off aws-xray-sdk-core to ADOT auto-instrumentation
- 6f0ae76: fix(imposter): build Lambda bundle as CommonJS instead of ESM, bundle AWS SDK v3 instead of externalizing

  Same ESM->CJS cold-start fix as pantry/portfolio (see pantry's changeset
  for the measured numbers). Also drops `external: ["@aws-sdk/*"]`, matching
  the fix already applied to pantry/portfolio earlier this cycle - relying on
  the Lambda runtime's built-in SDK copy added dynamic-linking overhead at
  Init time; bundling an explicit pinned copy avoided it.

- 8e2dce8: cut portfolio-graphql cold path latency
- 4303308: pin internal api-shared dependency by wildcard ("*") instead of an exact version, avoiding an intermittent npm ci resolution conflict against an unrelated public package of the same name
- Updated dependencies [fce1369]
- Updated dependencies [5e57e8f]
- Updated dependencies [0d1e57a]
  - api-shared@1.2.0

## 1.3.1

### Patch Changes

- 0584cff: add CORS headers to actual Lambda responses, not just preflight
- Updated dependencies [0584cff]
  - api-shared@1.1.3

## 1.3.0

### Minor Changes

- 74ea629: Apollo Federation supergraph gateway, prod and test

### Patch Changes

- 518b10d: remove scheduled warmup ping, make PC scheduling per-project
- 9c5b5fd: migrate ApiGatewayStack from HTTP API to REST API for real X-Ray trace propagation
- Updated dependencies [2c53dce]
- Updated dependencies [9c5b5fd]
  - api-shared@1.1.2

## 1.2.1

### Patch Changes

- 342c866: add Vitest unit test suites across all workspaces
- Updated dependencies [342c866]
  - api-shared@1.1.1

## 1.2.0

### Minor Changes

- a806e6f: add per-operation-count metrics across all GraphQL services

### Patch Changes

- 3eec52f: class-based conversions across imposter, pantry, portfolio
- Updated dependencies [a806e6f]
- Updated dependencies [7c8df31]
  - api-shared@1.1.0

## 1.1.0

### Minor Changes

- bf58948: auto-generate a changeset from the PR title when one is missing
