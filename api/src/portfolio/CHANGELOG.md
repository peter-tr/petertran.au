# portfolio

## 1.3.1

### Patch Changes

- cfa8fc5: refresh footer cost figures on a daily schedule, not per-request
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
- eca2441: Add the live petertran.au site as a "Website" link on the resume, alongside LinkedIn and GitHub.
- 7c8df31: extend X-Ray tracing to SES, Secrets Manager, Cost Explorer, and zero-trust-lab
- Updated dependencies [a806e6f]
- Updated dependencies [7c8df31]
  - api-shared@1.1.0

## 1.1.0

### Minor Changes

- bf58948: auto-generate a changeset from the PR title when one is missing
