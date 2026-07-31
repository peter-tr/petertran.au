# api

## 1.6.0

### Minor Changes

- 8c1bc30: warm-schedule's cost response now includes a last-24h cost estimate per project, combining real CloudWatch invocation/duration usage with an averaged share of the scheduled provisioned-concurrency cost

### Patch Changes

- dbf5cb1: auto-run the warm-schedule settings page's cold start check, and make its lookback window configurable

  The check across all 6 projects completes in a few seconds, so it now runs automatically (on page load and whenever the lookback window changes) instead of needing an explicit button click. The lookback window is now a picker (10 min / 1 hour / 24 hours) instead of a fixed 24h, via a new `windowMinutes` parameter on `warm-schedule`'s `checkColdStarts` action (validated against the same curated set on both sides, same "seeded in two places" convention as `MAX_CONCURRENCY`/`MEMORY_OPTIONS_MB`). No infra changes - this reuses the IAM grants and timeout bump already shipped in the initial cold-start-check PR.

- 1cf8143: fix reliability bug flagged by SonarQube: add initial value to reduce() in healWeightedAlias
- edea494: add reactive Provisioned Concurrency: 1hr warm after a real cold start, opt-in per project from the portfolio settings page, alongside a live "reactively warm until" status readout
- 59d2354: Fix a batch of SonarCloud code-smell findings in root api/ scripts: resolve e2e-smoke.ts's `tsx` PATH-lookup lint (S4036) via Node module resolution, convert e2e-smoke.ts's async wrapper to top-level await (S7785), reduce warm-schedule/handler.ts's `processEvent` cognitive complexity by extracting per-event-type handlers (S3776), and extract a nested ternary in zero-trust-lab/edge/proxy.ts into a lookup table (S3358).
- fba5b9c: self-heal a weighted Provisioned Concurrency alias in the warm-schedule reconciler

  AWS Lambda's own alias+PC safety net pins traffic to the last-good version via a weighted `RoutingConfig` when a new version fails to warm - but a weighted alias can never have Provisioned Concurrency attached, so once this triggers every reconcile tick fails forever and the target runs cold on every invocation. Hit for real 2026-07-27 across `portfolio-graphql`, `supergraph-graphql`, and `pantry-graphql` simultaneously. `reconcileTarget()` now clears a weighted alias (pinning to whichever version is already serving traffic - zero traffic impact) before attempting to grant PC, so this recovers automatically instead of needing a manual `aws lambda update-alias`/`delete-function` fix.

## 1.5.0

### Minor Changes

- b0487a5: add saveable/applyable "profiles" to the warm-schedule settings page

  Snapshots the whole 6-project provisioned-concurrency config (all
  schedules/concurrency/memory at once) under a name, stored in a new SSM
  parameter alongside the live config. The settings page can now save the
  current setup as a profile, apply a saved one back (flipping every
  project's real EventBridge schedules and reconciling PC/memory
  immediately, same as an individual project save), or delete one - so
  switching between modes (e.g. "all cold, 1024MB" vs "PC everywhere,
  512MB") no longer means hand-editing every row.

### Patch Changes

- 25e3615: apply mechanical SonarCloud fixes across api/web/infra
- b00797a: save all dirty warm-schedule projects in one atomic request
- 41c8e3b: smoke-test the supergraph Router config before every deploy
- bb5ce9b: add an on-demand "Check cold start rate" action to the warm-schedule settings page

  Runs a CloudWatch Logs Insights query (`filter @type = "REPORT" | stats count(@initDuration) as coldStarts, count(*) as total`) per project over the last 24h, aggregated across all of that project's target Lambdas, and surfaces the cold-start count/percentage next to each project's existing cost line - previously there was no way to tell from the settings page whether a given PC schedule was actually working. Kept as an explicit "check now" button rather than a live/cached figure, since Logs Insights queries are async and take several seconds each; the existing scheduled+cached pattern used for cost data would be overkill for a rarely-clicked diagnostic. `warm-schedule`'s Lambda gets new `logs:StartQuery`/`logs:GetQueryResults` IAM grants scoped to each target's own log group, and its timeout is bumped 60s -> 120s to give the new action real margin.

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
