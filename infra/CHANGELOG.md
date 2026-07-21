# infra

## 1.3.0

### Minor Changes

- 1984776: add supergraph to scheduled provisioned concurrency
- 74ea629: Apollo Federation supergraph gateway, prod and test

### Patch Changes

- 76e148e: stop warm-schedule deploys from wiping live settings, fix save UX
- 518b10d: remove scheduled warmup ping, make PC scheduling per-project
- d085a8e: make test-env ApiGatewayStack depend on its target stacks
- 9c5b5fd: migrate ApiGatewayStack from HTTP API to REST API for real X-Ray trace propagation
- 4165ddd: rename pc-config to warm-schedule for clarity

## 1.2.0

### Minor Changes

- 553f6a6: scheduled Provisioned Concurrency for portfolio/pantry/imposter + zero-trust-lab

### Patch Changes

- 342c866: add Vitest unit test suites across all workspaces
- 5bfa13e: make ApiGatewayStack explicitly depend on its target stacks
- c3bab6a: add www.test.petertran.au to the test environment
- d3c957a: reuse prod stack classes for the test env
- c9d227e: test-env ref-input trap and Lambda memory drift

## 1.1.0

### Minor Changes

- 36fcc26: add shared API Gateway in front of portfolio/pantry/imposter/warmup
- ac54c28: add on-demand test environment for safe big-change testing

## 1.0.1

### Patch Changes

- 070589c: Give every AWS resource an explicit, readable name instead of relying on CloudFormation's auto-generated ones (e.g. `PetertranSiteStack-ResumeTable5083EE1E-...`), so tables, the S3 site bucket, IAM roles, the zero-trust-lab KMS key/Cognito pools, and the RUM identity pool all read clearly in the console and X-Ray trace map.
- 7c8df31: extend X-Ray tracing to SES, Secrets Manager, Cost Explorer, and zero-trust-lab
