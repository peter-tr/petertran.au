# api

## 1.3.0

### Minor Changes

- f44c18f: add CloudWatch alarms/dashboard and an alert-email toggle

### Patch Changes

- 0584cff: add CORS headers to actual Lambda responses, not just preflight
- 93c0b32: supergraph cold-start + configurable PC concurrency

## 1.2.0

### Minor Changes

- e8ebe87: trace external fetch calls in supergraph and zero-trust-lab
- 1984776: add supergraph to scheduled provisioned concurrency
- 74ea629: Apollo Federation supergraph gateway, prod and test

### Patch Changes

- 518b10d: remove scheduled warmup ping, make PC scheduling per-project
- 2c53dce: propagate X-Ray trace header to subgraph/domain gateway calls
- 9c5b5fd: migrate ApiGatewayStack from HTTP API to REST API for real X-Ray trace propagation
- 4165ddd: rename pc-config to warm-schedule for clarity
- 0da41b5: cut prod frontend over to the supergraph endpoint; raise the supergraph
  handler test's timeout for a cold CI cache

## 1.1.0

### Minor Changes

- 553f6a6: scheduled Provisioned Concurrency for portfolio/pantry/imposter + zero-trust-lab

### Patch Changes

- 342c866: add Vitest unit test suites across all workspaces

## 1.0.1

### Patch Changes

- 7c8df31: extend X-Ray tracing to SES, Secrets Manager, Cost Explorer, and zero-trust-lab
