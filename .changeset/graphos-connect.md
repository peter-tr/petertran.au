---
"infra": patch
"supergraph": patch
---

connect the supergraph Router to Apollo GraphOS for Studio usage reporting

`SupergraphStack` now resolves `APOLLO_KEY`/`APOLLO_GRAPH_REF` (graph `petertran-au@current`) into the Router Lambda's env at deploy time, the same `secretValue.unsafeUnwrap()` pattern used for the Anthropic keys - Router auto-detects these and starts reporting operation metrics/errors to GraphOS Studio. This is independent of schema composition: Router still resolves the supergraph from the build-time offline-composed file (`--supergraph` in `bootstrap`), so cold-start Init Duration is unaffected.

`build-router-package.ts`'s generated `router.yaml` also tightens `telemetry.apollo.metrics.usage_reports.batch_processor.scheduled_delay` to `1ms` - Apollo's usage-reporting exporter has its own 5s-default batch flush, separate from the OTLP tracing one already tuned here, and would otherwise sit unflushed when Lambda freezes the execution environment right after the response returns (the same failure mode already hit once for X-Ray traces).

CI (`build-and-deploy.yml`, `verify.yml`) now publishes all 4 subgraphs to GraphOS on every prod deploy and runs `rover subgraph check` on PRs for any subgraph whose schema changed, via `npx @apollo/rover@0.41.0` rather than a marketplace GitHub Action.
