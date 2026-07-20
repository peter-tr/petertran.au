# Warmup + Provisioned Concurrency

Investigation and design notes from the 2026-07-20 session that (a) measured
how well the existing warmup schedule actually works, and (b) added scheduled
Provisioned Concurrency (PC) for portfolio/pantry/imposter on top of it.

## Warmup: the "5-45 min idle-reclaim window" doesn't hold here

The commonly-cited AWS Lambda idle-reclaim window is "5-45 minutes," but
that's not officially documented and clearly varies by account/traffic
pattern. Live bisection against zero-trust-lab's Lambdas (which get *zero*
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
concurrent-executions quota was pinned at 10 (AWS's stated default is
1000) - PC cannot be granted at all below that floor (AWS requires >=10 to
stay unreserved). Fixed via a Service Quotas increase request to exactly
1000 (requesting less than the stated default gets rejected outright);
auto-approved within minutes. If this ever needs revisiting, check
`aws lambda get-account-settings` first - it won't show up in `cdk diff`.

### Pricing (AWS Pricing API, ap-southeast-2, effective 2026-07-01)

- Provisioned Concurrency: $0.0000052360/GB-s
- Standard on-demand duration: $0.0000166667/GB-s (Tier 1)
- Duration while PC is active: $0.0000122173/GB-s (cheaper - init already paid)

| Memory | 8am-7pm Sydney (11h/day) | 24/7 |
|---|---|---|
| 256MB, 1 instance | ~$1.58/mo | ~$3.44/mo |
| 128MB, 1 instance | ~$0.79/mo | ~$1.72/mo |

portfolio + pantry + imposter together: **~$4.73/mo** on the 8-7 schedule
(vs ~$10.32/mo if run 24/7).

## Cold vs warm start, measured (all Lambdas)

"Cold" = invocations with an `Init Duration` in the REPORT log line (a real
cold start); "warm" = invocations without one. For portfolio/pantry/imposter,
the "warm" number below is *real request latency* (DB/Anthropic calls
included), not idle overhead - the actual cold-start tax on top of that is
the separate `avg Init` column. For everything else (warmup-only or
scheduled-job Lambdas with no real work on the hot path), warm duration *is*
close to pure overhead.

| Function | Alloc | Avg cold (total) | Avg Init (the actual cold tax) | Avg warm | Sample (7d, cold/warm) |
|---|---|---|---|---|---|
| portfolio-graphql | 256MB | 1860ms | 1021ms | 455ms\* | 240 / 377 |
| pantry-graphql | 256MB | 974ms | 854ms | 247ms\* | 177 / 282 |
| imposter-graphql | 256MB | 856ms | 739ms | 164ms\* | 179 / 79 |
| pc-config | 128MB | 2398ms | 633ms | 380ms\* | 4 / 7 |
| warmup-config | 128MB | 1314ms | 385ms | 803ms\* | 4 / 2 (too small to trust) |
| pantry-digest | 256MB | 1515ms | 609ms | - | 28 / 0 (hourly - always cold, same story as ZTL) |
| pantry-price-check | 256MB | 27281ms | 580ms | - | 5 / 0 (on-demand only - always cold; the ~27s is real work, mostly Anthropic web_search/web_fetch, not cold start) |
| ztl-idp-bridge | 256MB | ~598ms | (~596ms of the ~598ms) | ~1.5-32ms | 141 / 0 naturally, warm via manual back-to-back invoke |
| ztl-edge-authorizer | 256MB | ~466ms | (~448ms) | ~1.7-165ms | 138 / 0 naturally, ditto |
| ztl-internal-sts | 256MB | ~423ms | (~426ms) | ~1.5-2.4ms | 140 / 0 naturally, ditto |
| ztl-edge-proxy | 256MB | ~149ms | (~137ms) | ~1.3-3.4ms | 137 / 0 naturally, ditto |
| ztl-domain-a | 128MB | ~142ms | (~138ms) | ~1.3-1.6ms | 145 / 0 naturally, ditto |

\* real request latency on a warm container, not pure overhead - see note above.

idp-bridge/internal-sts/edge-authorizer's heavier ZTL cold start is almost
entirely Init Duration from Cognito/KMS SDK client construction at module
scope - the warmup path itself returns immediately (`isWarmupPing`) same as
every project.

## Zero-trust-lab: cost is negligible either way

All 5 ZTL warmup pings combined cost **~$0.036/month total** (idp-bridge
$0.011, edge-authorizer $0.009, internal-sts $0.008, edge-proxy $0.003,
domain-a $0.001) - cost was never actually the problem with this schedule,
the tight reclaim window was.

**If PC were added to ZTL on the same 8am-7pm schedule** (only worth it for
snappier manual/demo testing - ZTL still has zero organic traffic, so
there's no real visitor being protected the way portfolio/pantry/imposter's
PC protects real hiring-manager/user traffic):

| Scenario | Monthly cost (all 5) |
|---|---|
| At current memory (4x256MB + domain-a's 128MB) | ~$7.10/mo |
| If internal-sts + edge-proxy rightsized to 128MB first | ~$5.52/mo |

### Memory rightsizing candidates (7-day peak `Max Memory Used` vs allocated)

Not uniform - don't blanket-apply 128MB:

| Function | Allocated | 7-day peak | 128MB safe? |
|---|---|---|---|
| internal-sts | 256MB | 94MB | **Yes** - 27% headroom |
| edge-proxy | 256MB | 87MB | **Yes** - 32% headroom |
| domain-a | 128MB | 68MB | Already there, 47% headroom |
| idp-bridge | 256MB | 119MB | **No** - only 7% headroom |
| edge-authorizer | 256MB | 129MB | **No** - already exceeds 128MB, would OOM |
