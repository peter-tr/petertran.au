# api

## 1.4.0

### Minor Changes

- 2fd594a: extend scheduled Provisioned Concurrency to design-studio
- 028291a: show a real, live-computed price per project on the warm-schedule settings section - each project's real Lambda memory size and currently-allocated provisioned concurrency, queried live via GetFunctionConfiguration/GetProvisionedConcurrencyConfig, instead of one static "~$1.58/mo" estimate for all of them

### Patch Changes

- 038fdde: cut cold-start latency from Mongo connection setup
- 38dfeb2: migrate imposter/design-studio/pantry/portfolio off aws-xray-sdk-core to ADOT auto-instrumentation
- 5327745: derive RUM's X-Ray origin from config, deflake jwt.test.ts
- c8deef2: add CORS headers to alerts-settings responses
- 8e2dce8: cut portfolio-graphql cold path latency
- c5a5340: add shared api/scripts/build-lambda.ts helper for CJS Lambda bundling

  New shared build-time helper (`buildCjsLambdas()`) used by portfolio,
  pantry, imposter, and design-studio's own build scripts - see each
  project's own changeset for what it does and why.

- 46d2050: add Design Studio, a mock-Canva editor (MongoDB Atlas-backed)
- 20f295d: let memory size become a live settings-page control alongside Provisioned Concurrency scheduling

  Adds `memoryMb` to the warm-schedule config (settings page, `/warm-schedule`
  endpoint, and CDK's `WarmSchedule` type), reconciled the same way concurrency
  already is - `handler.ts`'s new `reconcileMemory()` runs
  `UpdateFunctionConfiguration` -> `PublishVersion` -> `UpdateAlias` whenever a
  target's live memory differs from what's configured, verified live against a
  throwaway Lambda that Provisioned Concurrency granted on an alias qualifier
  automatically re-provisions against wherever the alias points after a move,
  so no separate stale-version cleanup is needed.

  Also switches portfolio/pantry/imposter/design-studio's main GraphQL Lambda
  from 1024MB to 512MB, doubling their Provisioned Concurrency counts - cost-
  neutral (PC is priced in GB-seconds, so 1x1024MB costs the same as
  2x512MB), and directly fixes PC's actual capacity shortfall (a single page
  load fires more than one concurrent GraphQL request, enough to exceed PC=1
  on its own) rather than the 1024MB bump's original premise (more memory
  directly cuts cold-start latency), which didn't hold up under isolated
  testing once the real ESM/ADOT cold-start cause was fixed separately.

- b9ed5ad: fix warm-schedule handler catching the wrong AWS exception for "no PC config found", which 502'd the settings page's provisioned concurrency status endpoint whenever any target was outside its warm window

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
