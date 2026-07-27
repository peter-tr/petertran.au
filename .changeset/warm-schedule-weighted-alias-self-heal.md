---
"api": patch
---

self-heal a weighted Provisioned Concurrency alias in the warm-schedule reconciler

AWS Lambda's own alias+PC safety net pins traffic to the last-good version via a weighted `RoutingConfig` when a new version fails to warm - but a weighted alias can never have Provisioned Concurrency attached, so once this triggers every reconcile tick fails forever and the target runs cold on every invocation. Hit for real 2026-07-27 across `portfolio-graphql`, `supergraph-graphql`, and `pantry-graphql` simultaneously. `reconcileTarget()` now clears a weighted alias (pinning to whichever version is already serving traffic - zero traffic impact) before attempting to grant PC, so this recovers automatically instead of needing a manual `aws lambda update-alias`/`delete-function` fix.
