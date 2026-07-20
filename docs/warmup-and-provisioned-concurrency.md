# Warmup + Provisioned Concurrency

Investigation and design notes from the 2026-07-20 session that (a) measured
how well the existing warmup schedule actually works, and (b) added scheduled
Provisioned Concurrency (PC) for portfolio/pantry/imposter and, later,
zero-trust-lab's 5 Lambdas on top of it.

## Warmup: the "5-45 min idle-reclaim window" doesn't hold here

The commonly-cited AWS Lambda idle-reclaim window is "5-45 minutes," but
that's not officially documented and clearly varies by account/traffic
pattern. Live bisection against zero-trust-lab's Lambdas (which get _zero_
organic traffic - every invocation on them is the warmup ping itself, so
there's no real traffic to confound the measurement) found the real window
here is **~2m10s-3m20s idle** before the execution environment is reclaimed.

That means the existing 10-minute warmup schedule (`infra/lib/shared/warmup-schedule.ts`)
never actually prevents a cold start for zero-trust-lab - every single ping
is itself cold. It still runs (kept as-is, see cost section below) because:

1. Tightening the interval enough to matter (~2 min) buys nothing - nothing
   but the ping ever calls these 5 Lambdas, so there's no real visitor to
   protect regardless of interval.
2. portfolio/pantry/imposter don't have this problem in practice - real user
   traffic interleaves with the ping and keeps a container warm anyway.

## Provisioned Concurrency for portfolio/pantry/imposter

Shipped on `feature/pc-scheduling`. portfolio/pantry/imposter each:

- Were rightsized 512MB -> 256MB (measured week-long peak memory was
  163-186MB on all three - still 27-46%+ headroom)
- Got a `live` Lambda alias (`infra/lib/shared/function-names.ts`'s
  `LIVE_ALIAS_NAME`) - real traffic (`api.petertran.au`) and warmup pings for
  these three both target it now, not `$LATEST`
- Get 1x Provisioned Concurrency, 8am-7pm Australia/Sydney daily, toggleable
  per-function from the portfolio Settings page

See `infra/lib/pc-config-stack.ts`'s doc comment for the full design
rationale - in short, a small Lambda (`pc-config`) directly calls
`Put`/`DeleteProvisionedConcurrencyConfig` on an hourly reconcile schedule
and on every settings toggle, rather than using CDK's native
`Alias.addAutoScaling()` / Application Auto Scaling scheduled actions (whose
suspended-scheduled-actions-don't-retroactively-undo-capacity behavior would
mean a toggle-off mid-day doesn't actually stop billing until the next tick).

**Account-level gotcha hit during rollout:** this AWS account's Lambda
concurrent-executions quota was pinned at 10 (AWS's stated default is 1000) - PC cannot be granted at all below that floor (AWS requires >=10 to
stay unreserved). Fixed via a Service Quotas increase request to exactly
1000 (requesting less than the stated default gets rejected outright);
auto-approved within minutes. If this ever needs revisiting, check
`aws lambda get-account-settings` first - it won't show up in `cdk diff`.

### Pricing (AWS Pricing API, ap-southeast-2, effective 2026-07-01)

- Provisioned Concurrency: $0.0000052360/GB-s
- Standard on-demand duration: $0.0000166667/GB-s (Tier 1)
- Duration while PC is active: $0.0000122173/GB-s (cheaper - init already paid)

| Memory            | 8am-7pm Sydney (11h/day) | 24/7      |
| ----------------- | ------------------------ | --------- |
| 256MB, 1 instance | ~$1.58/mo                | ~$3.44/mo |
| 128MB, 1 instance | ~$0.79/mo                | ~$1.72/mo |

portfolio + pantry + imposter together: **~$4.73/mo** on the 8-7 schedule
(vs ~$10.32/mo if run 24/7).

## Cold vs warm start, measured (all Lambdas)

"Cold" = invocations with an `Init Duration` in the REPORT log line (a real
cold start); "warm" = invocations without one. For portfolio/pantry/imposter,
the "warm" number below is _real request latency_ (DB/Anthropic calls
included), not idle overhead - the actual cold-start tax on top of that is
the separate `avg Init` column. For everything else (warmup-only or
scheduled-job Lambdas with no real work on the hot path), warm duration _is_
close to pure overhead.

| Function            | Alloc | Avg cold (total) | Avg Init (the actual cold tax) | Avg warm   | Sample (7d, cold/warm)                                                                                             |
| ------------------- | ----- | ---------------- | ------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------ |
| portfolio-graphql   | 256MB | 1860ms           | 1021ms                         | 455ms\*    | 240 / 377                                                                                                          |
| pantry-graphql      | 256MB | 974ms            | 854ms                          | 247ms\*    | 177 / 282                                                                                                          |
| imposter-graphql    | 256MB | 856ms            | 739ms                          | 164ms\*    | 179 / 79                                                                                                           |
| pc-config           | 128MB | 2398ms           | 633ms                          | 380ms\*    | 4 / 7                                                                                                              |
| warmup-config       | 128MB | 1314ms           | 385ms                          | 803ms\*    | 4 / 2 (too small to trust)                                                                                         |
| pantry-digest       | 256MB | 1515ms           | 609ms                          | -          | 28 / 0 (hourly - always cold, same story as ZTL)                                                                   |
| pantry-price-check  | 256MB | 27281ms          | 580ms                          | -          | 5 / 0 (on-demand only - always cold; the ~27s is real work, mostly Anthropic web_search/web_fetch, not cold start) |
| ztl-idp-bridge      | 256MB | ~598ms           | (~596ms of the ~598ms)         | ~1.5-32ms  | 141 / 0 naturally, warm via manual back-to-back invoke                                                             |
| ztl-edge-authorizer | 256MB | ~466ms           | (~448ms)                       | ~1.7-165ms | 138 / 0 naturally, ditto                                                                                           |
| ztl-internal-sts    | 256MB | ~423ms           | (~426ms)                       | ~1.5-2.4ms | 140 / 0 naturally, ditto                                                                                           |
| ztl-edge-proxy      | 256MB | ~149ms           | (~137ms)                       | ~1.3-3.4ms | 137 / 0 naturally, ditto                                                                                           |
| ztl-domain-a        | 128MB | ~142ms           | (~138ms)                       | ~1.3-1.6ms | 145 / 0 naturally, ditto                                                                                           |

\* real request latency on a warm container, not pure overhead - see note above.

idp-bridge/internal-sts/edge-authorizer's heavier ZTL cold start is almost
entirely Init Duration from Cognito/KMS SDK client construction at module
scope - the warmup path itself returns immediately (`isWarmupPing`) same as
every project.

## Zero-trust-lab: PC extended here too, cost is negligible either way

All 5 ZTL warmup pings combined cost **~$0.036/month total** (idp-bridge
$0.011, edge-authorizer $0.009, internal-sts $0.008, edge-proxy $0.003,
domain-a $0.001) - cost was never actually the problem with this schedule,
the tight reclaim window was. Despite ZTL having zero organic traffic (PC
here only speeds up manual testing/demos of the lab, not real visitors),
scheduled PC was extended to cover it too - decided cheap enough to be worth
it.

### Memory rightsizing applied (7-day peak `Max Memory Used` vs allocated)

Not uniform - didn't blanket-apply 128MB:

| Function        | Allocated          | 7-day peak | 128MB safe?                           |
| --------------- | ------------------ | ---------- | ------------------------------------- |
| internal-sts    | 256MB -> **128MB** | 94MB       | Yes - 27% headroom                    |
| edge-proxy      | 256MB -> **128MB** | 87MB       | Yes - 32% headroom                    |
| domain-a        | 128MB (unchanged)  | 68MB       | Already there, 47% headroom           |
| idp-bridge      | 256MB (unchanged)  | 119MB      | No - only 7% headroom                 |
| edge-authorizer | 256MB (unchanged)  | 129MB      | No - already exceeds 128MB, would OOM |

All 5 get PC 8am-7pm Sydney under one combined `zeroTrustLab` flag (not 5
independent ones) - they only work as a pipeline together (edge-authorizer
needs internal-sts warm too, domain-a's JWT verification needs internal-sts's
JWKS endpoint reachable), so per-function toggles would just let them drift
out of sync for no benefit. Cost: ~$5.52/mo for all 5 (vs ~$7.10/mo if the
two rightsizing candidates had stayed at 256MB).

### Why this needed more than just an alias

Unlike portfolio/pantry/imposter (one shared `ApiGatewayStack`, alias swapped
in via one prop), ZTL's 5 Lambdas are wired together as their own
token-exchange pipeline with no shared API Gateway - every real entry point
needed retargeting to the `live` alias for PC to matter at all:

- `idp-bridge`/`internal-sts`'s **Function URLs** are built from the alias
  now (`alias.addFunctionUrl(...)`, not `fn.addFunctionUrl(...)`) - this
  changes the actual URL (Lambda derives it from the qualified ARN), which
  cascades into Cognito's OAuth `callbackUrls` and the JWT issuer/JWKS URL.
  Both `idp-bridge/handler.ts` and `internal-sts/handler.ts` already derive
  their redirect URI/issuer from `event.requestContext.domainName` at
  runtime, so neither needed a code change to pick up the new URL.
- `edge-authorizer`'s direct IAM-gated `Invoke` call to `internal-sts` did
  need a code change (`api/src/zero-trust-lab/edge/authorizer.ts`) - added
  an explicit `Qualifier: "live"` to the `InvokeCommand`, since it was
  targeting `$LATEST` by default.
- `edge-authorizer` (the Lambda Authorizer), `edge-proxy`, and `domain-a`
  (the two HttpApi integrations) all now point at their respective aliases.

Verified end-to-end post-deploy without a browser (none available this
session for the interactive Cognito Hosted UI login): manually `PutItem`'d a
valid session row into `ztl-sessions`, then called the edge HttpApi's
`/domain-a/` route with that token as `Bearer` auth - exercised introspect,
the direct-invoke exchange, the Lambda authorizer, and domain-a's native JWT
verification all the way through. Independently verified the issued JWT's
RS256 signature against the live JWKS with `pyjwt` too. First attempt
401'd - stale API Gateway JWKS cache from the URL churn during redeploys
(see below); a fresh token a few seconds later got a clean `200`.

## Real-world hazards hit during this rollout

**Concurrent deploys to the same AWS account.** This account's `main` branch
auto-deploys via GitHub Actions on every merge (`.github/workflows/deploy.yml`).
Mid-session, an unrelated merge to `main` (predating this feature) triggered
a production deploy that silently reverted portfolio/pantry/imposter's and
ZTL's new aliases and the `pc-config` API route - discovered when
`pc-config`'s endpoint started 404ing minutes after it had worked. Fix was
mechanical (merge `main` into the feature branch, resolve the one real
conflict in `bin/app.ts`, redeploy), but the lesson is structural: a local
`cdk deploy` racing an unrelated CI deploy to the same account will lose
resources non-atomically, stack by stack, with no warning. Worth checking
`gh run list --workflow=deploy.yml` before _and immediately after_ any
manual production deploy in this account.

**A `cdk diff` "replace" that wasn't real.** After that merge, `cdk diff`
started showing `PetertranSiteStack`'s SES DKIM Route53 record as
`requires replacement` with an unresolvable future value, appearing only
when the new `LiveAlias` construct was present (confirmed via bisection - a
diff with just the memory change didn't show it). Traced it as far as: the
underlying `SesDomainIdentity` resource, its logical ID, and its live DKIM
token were all byte-identical before/after; a clean checkout of `main` alone
showed zero diff. Deployed anyway given that evidence - the actual deploy
completed with the DKIM record completely untouched. Treat this as a
reminder that `cdk diff`'s "read-only changeset" preview can flag
`Fn::GetAtt`-derived properties as replacing when a changeset touches
_anything else_ in the stack, even when the source attribute genuinely isn't
changing - worth a real deploy's resource list (not just the diff) as the
final check on anything this consequential.
