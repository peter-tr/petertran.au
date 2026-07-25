---
"design-studio": minor
"infra": minor
---

feat(infra,design-studio): add design-studio to the on-demand test environment

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
