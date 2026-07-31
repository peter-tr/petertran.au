# infra

## 1.7.0

### Minor Changes

- 503e568: enable GraphOS subgraph metrics, bump Router to 2.16.0, remove ADOT collector

### Patch Changes

- 92ff733: fix reliability code smell flagged by SonarQube: use the test MonitoringStack instance via addDependency instead of leaving it uncaptured
- edea494: add reactive Provisioned Concurrency: 1hr warm after a real cold start, opt-in per project from the portfolio settings page, alongside a live "reactively warm until" status readout
- 59d2354: Fix a SonarCloud cognitive-complexity finding in monitoring-stack.ts: reduce `MonitoringStack`'s constructor from 28 to under 15 by extracting alarm-topic creation, per-function/per-table registration, the alerts-settings Lambda, and dashboard-row building into named helper functions (S3776). No behavior change.
- 8c1bc30: grant warm-schedule's Lambda `cloudwatch:GetMetricData` so it can compute the new last-24h cost estimate
- 9e74092: fix: grant lambda:GetAlias so warm-schedule's alias self-heal (#232) can actually run - every reconcile tick for every project was silently failing with AccessDeniedException before this

## 1.6.0

### Minor Changes

- 6432904: add a WAF rate-based rule (per-IP, COUNT mode) to the shared API Gateway stage

  The app-level DynamoDB rate limiters (`api-shared/rate-limit`) reject a request only after it's already paid for a full Lambda invocation and a DynamoDB write - a WAF rate-based rule rejects at the edge, before either happens, but can't see GraphQL operation names to differentiate cost, so this is additive to those limiters, not a replacement. `ApiGatewayStack` now provisions a regional `AWS::WAFv2::WebACL` with one rate-based rule (100 req/IP/60s, `Count` action, not `Block`) associated with the RestApi's deployment stage, covering every route behind it (portfolio/pantry/imposter/supergraph/design-studio) in one place. Deliberately starts in COUNT rather than BLOCK - the 100/min threshold is a starting point, not validated against real traffic yet; flipping the rule's `action` to `Block` is a follow-up change once the `RateLimitByIp` CloudWatch metric shows what real usage looks like.

- 992ade4: `DesignStudioStack` now takes a required `supergraphUrl` prop (mirroring `SupergraphStackProps.apiBaseUrl`) and passes it into the Lambda as `SUPERGRAPH_URL`, letting design-studio's new opt-in portfolio-data-lookup tool call the real public composed supergraph endpoint. No new IAM grant - a plain outbound HTTPS call to a public endpoint, same reasoning already documented for why the Router itself needs none to reach subgraphs. The Lambda's timeout goes from 30s to 40s to cover the new tool loop's worst-case added latency (up to 2 iterations of the supergraph call plus Claude round trip) on top of the existing generation call.
- 7ff6b62: add a pantry settings toggle for the AI command bar's provider (direct Anthropic API or AWS Bedrock) and model tier (Haiku/Sonnet), matching design-studio's existing AiSettings pattern. Extracted the provider/model-ID resolution and Bedrock IAM policy into shared modules (`api-shared/ai-provider`, `infra/lib/shared/bedrock-models.ts`) so design-studio and pantry share one implementation instead of two copies. Price checking (Coles lookups) always stays on the direct Anthropic API, since Bedrock doesn't support the web_search/web_fetch tools it depends on.
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

- 7ff1033: resolve the Anthropic API key(s) into Lambda env vars at deploy time instead of fetching from Secrets Manager at runtime

  X-Ray traces showed a ~300ms median (p99 ~1.7s) `GetSecretValue` round trip on every cold start that touched `getAnthropicClient()`/`getAnthropicAdminApiKey()`, and cold starts turned out to be 13-25% of invocations across portfolio/pantry/imposter/design-studio over a 7-day sample - not the rare case the runtime-fetch design assumed. `ANTHROPIC_API_KEY`/`ANTHROPIC_ADMIN_API_KEY` are now resolved via `secretValue.unsafeUnwrap()` (a CloudFormation dynamic reference resolved at deploy time), the same pattern `design-studio-stack.ts` already used for `MONGO_URI`. No application code changes needed - both `anthropic-client.ts` and `anthropic-cost.ts` already preferred a direct env var over the Secrets Manager fallback. Confirmed live: zero `SecretsManager` subsegments across all four Lambdas' first (cold) invocations post-deploy.

- d1fd49b: allow apollographql-client-name in API Gateway CORS preflight [URGENT - prod broken for real users]
- 88290e3: allow apollo-federation-include-trace in API Gateway CORS preflight
- 25e3615: apply mechanical SonarCloud fixes across api/web/infra
- 05105be: allow studio.apollographql.com in API Gateway CORS preflight + credentials
- 3c08a9c: connect the supergraph Router to Apollo GraphOS for Studio usage reporting

  `SupergraphStack` now resolves `APOLLO_KEY`/`APOLLO_GRAPH_REF` (graph `petertran-au@current`) into the Router Lambda's env at deploy time, the same `secretValue.unsafeUnwrap()` pattern used for the Anthropic keys - Router auto-detects these and starts reporting operation metrics/errors to GraphOS Studio. This is independent of schema composition: Router still resolves the supergraph from the build-time offline-composed file (`--supergraph` in `bootstrap`), so cold-start Init Duration is unaffected.

  `build-router-package.ts`'s generated `router.yaml` also tightens `telemetry.apollo.metrics.usage_reports.batch_processor.scheduled_delay` to `1ms` - Apollo's usage-reporting exporter has its own 5s-default batch flush, separate from the OTLP tracing one already tuned here, and would otherwise sit unflushed when Lambda freezes the execution environment right after the response returns (the same failure mode already hit once for X-Ray traces).

  CI (`build-and-deploy.yml`, `verify.yml`) now publishes all 4 subgraphs to GraphOS on every prod deploy and runs `rover subgraph check` on PRs for any subgraph whose schema changed, via `npx @apollo/rover@0.41.0` rather than a marketplace GitHub Action.

- bb5ce9b: add an on-demand "Check cold start rate" action to the warm-schedule settings page

  Runs a CloudWatch Logs Insights query (`filter @type = "REPORT" | stats count(@initDuration) as coldStarts, count(*) as total`) per project over the last 24h, aggregated across all of that project's target Lambdas, and surfaces the cold-start count/percentage next to each project's existing cost line - previously there was no way to tell from the settings page whether a given PC schedule was actually working. Kept as an explicit "check now" button rather than a live/cached figure, since Logs Insights queries are async and take several seconds each; the existing scheduled+cached pattern used for cost data would be overkill for a rarely-clicked diagnostic. `warm-schedule`'s Lambda gets new `logs:StartQuery`/`logs:GetQueryResults` IAM grants scoped to each target's own log group, and its timeout is bumped 60s -> 120s to give the new action real margin.

## 1.5.0

### Minor Changes

- 2fd594a: extend scheduled Provisioned Concurrency to design-studio
- d0654b9: redesign the monitoring dashboard, add a separate test-env dashboard
- 5bf2b32: link CloudWatch RUM sessions to their X-Ray traces
- 0424799: enable X-Ray tracing on the RUM app monitor
- fce1369: design-studio AI generation: switch default model from Haiku 4.5 to Sonnet 4.6, add a provider/model picker (direct Anthropic API or AWS Bedrock), and improve the generation prompt with a worked example and margin/alignment/contrast rules
- e68ec68: restore X-Ray tracing for the Router-based supergraph Lambda
- 46d2050: add Design Studio, a mock-Canva editor (MongoDB Atlas-backed)
- 2356941: add AI-assisted design generation to Design Studio - a "Generate with AI" prompt that produces a set of design elements from a natural-language description (via a new `generateDesignElements` mutation, Anthropic structured output, and a Mongo-backed rate limiter since Design Studio has no DynamoDB table). The result renders as a dashed-outline draft overlay, draggable/resizable independently of the real canvas and outside undo/redo history, until the user explicitly Accepts (adding it to the design) or Discards it.
- 890b543: feat(infra,design-studio): add design-studio to the on-demand test environment

  `PetertranTestDesignStudioStack` now deploys alongside the other 4 test
  subgraphs, wired into the test API Gateway and reachable through the test
  supergraph's composed `/graphql` endpoint. Isolated from prod by MongoDB
  database name (`design-studio-test` vs `design-studio`) rather than a
  second manually-provisioned Atlas cluster - the Lambda's `MONGO_DB_NAME`
  env var now controls this, defaulting to prod's existing behavior.

  `deploy-test-env.yml`/`destroy-test-env.yml` also now include
  `PetertranTestMonitoringStack`, which was previously instantiated in
  `infra/bin/app.ts` but never wired into either workflow's stack list - it
  could never actually deploy, and would have been orphaned (undeletable via
  the normal destroy workflow) if anyone ever deployed it manually.

  Also fixes `scripts/lib/tracked-packages.mjs`, which was missing
  `api/src/design-studio/` and `api/src/supergraph/` entries and so mis-tagged
  changes to either as `"api"` - the same mistagging problem CLAUDE.md already
  documents as having happened repeatedly for these two packages.

- 0d1e57a: add multi-user support to pantry: sign in via a new Cognito Hosted UI pool to get a private inventory/shopping list/settings, scoped by `pk`. Anyone not signed in keeps using the existing shared/default pantry unchanged.
- 028291a: show a real, live-computed price per project on the warm-schedule settings section - each project's real Lambda memory size and currently-allocated provisioned concurrency, queried live via GetFunctionConfiguration/GetProvisionedConcurrencyConfig, instead of one static "~$1.58/mo" estimate for all of them

### Patch Changes

- 038fdde: cut cold-start latency from Mongo connection setup
- 38dfeb2: migrate imposter/design-studio/pantry/portfolio off aws-xray-sdk-core to ADOT auto-instrumentation
- db1ad33: reconcile provisioned concurrency immediately after deploy
- 2015eae: bump portfolio/pantry/imposter/supergraph/design-studio Lambda memory to 1024MB
- b9ee226: replace Node @apollo/gateway with Apollo Router on Lambda
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

- 725cfe2: fix `lambda:UpdateAlias` IAM grant for warm-schedule's memory reconciliation

  The grant was scoped to each target's alias-qualified ARN
  (`function:name:live`), but AWS authorizes Lambda alias CRUD actions
  (`UpdateAlias`/`CreateAlias`/`DeleteAlias`) against the function's own
  bare ARN, not the alias-qualified one - confirmed live via a real
  `AccessDeniedException` the moment a schedule's `memoryMb` diverged from
  a target's actual live memory (first hit for `supergraph-graphql` and
  the zero-trust-lab targets, whose CDK `memorySize` was never changed in
  the memory-setting rollout). This silently aborted `reconcileTarget`
  before it reached the PC grant/delete step for those targets, breaking
  their scheduled Provisioned Concurrency on/off reconciliation too.

- 23c171e: fix(pantry): forward the authorization header through the API Gateway CORS allowlist and the supergraph gateway to subgraphs - two separate bugs meant a signed-in pantry request never actually reached the pantry Lambda authenticated: the browser's CORS preflight rejected `authorization` outright (it wasn't in the gateway's `Access-Control-Allow-Headers`), and even past that, `RemoteGraphQLDataSource` doesn't forward the original request's headers to a subgraph on its own - the supergraph handler now copies it from context in `willSendRequest`. Verified against the live deployed API: `ensureAccount`/`me` returned "Not signed in."/`null` for a valid Cognito token before this fix, and the account's own id/email after it.
- 9a13482: fix(infra): suffix pantry's auto-confirm Lambda name for the test env

  `PantryAutoConfirmFunction` (the Cognito PreSignUp trigger backing
  pantry's frictionless sign-up) had a hardcoded `functionName:
"pantry-auto-confirm"`, unlike every other named resource in
  `pantry-stack.ts` - missed when this trigger was added. Surfaced as a real
  deploy failure: `PetertranTestPantryStack` tried to create a Lambda with
  that same literal name and collided with prod's already-existing one
  (Lambda function names are unique per account/region). Now suffixed
  `-test` in the test env, matching the rest of the stack.

- 521d9ce: fix(pantry): drop `standardAttributes` from PantryUserPool - it modifies Cognito's User Pool `Schema`, which the `UpdateUserPool` API doesn't support changing on an existing pool. Deploying PR #151 failed on this (`Invalid AttributeDataType input`) and rolled back cleanly; email is already implied by `signInAliases: { email: true }`, so the prop was redundant anyway.
- b9a786b: fix(pantry): replace Cognito Hosted UI sign-in with an in-app email/password form - Hosted UI's authorization-code flow never actually completed in production because Cognito's `/oauth2/token` endpoint doesn't return CORS headers for a browser `fetch`. Sign-in/sign-up now call Cognito's IdP API directly with USER_PASSWORD_AUTH, with no email verification step and no MFA (a new pre-sign-up Lambda trigger auto-confirms accounts), and the header now shows an explicit "Sign out" label once signed in.

## 1.4.0

### Minor Changes

- f44c18f: add CloudWatch alarms/dashboard and an alert-email toggle

### Patch Changes

- 81fa4b5: broaden WarmScheduleParam clobber warning past just project add/remove
- cfa8fc5: refresh footer cost figures on a daily schedule, not per-request
- fe9a2dd: Fix AlertsSettingsFunction's SNS subscription-attribute permissions, which were denied live despite looking correctly scoped
- b43199c: stop client-routed pages from flashing the home page's prerendered content
- 93c0b32: supergraph cold-start + configurable PC concurrency

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
