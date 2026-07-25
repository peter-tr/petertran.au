---
"api": patch
"infra": patch
"web": patch
---

let memory size become a live settings-page control alongside Provisioned Concurrency scheduling

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
