---
"infra": patch
---

fix `lambda:UpdateAlias` IAM grant for warm-schedule's memory reconciliation

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
