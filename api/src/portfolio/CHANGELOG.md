# portfolio

## 1.3.2

### Patch Changes

- 6f0ae76: fix(portfolio): build Lambda bundle as CommonJS instead of ESM to fix ADOT cold-start regression

  Same fix as pantry (see its changeset for the measured before/after
  numbers) - ESM's import-in-the-middle instrumentation hook under the ADOT
  layer was responsible for most of this project's ~3.7s cold starts.

- 38dfeb2: migrate imposter/design-studio/pantry/portfolio off aws-xray-sdk-core to ADOT auto-instrumentation
- 8e2dce8: cut portfolio-graphql cold path latency
- 5e57e8f: strip the Apollo Router's `__<subgraph>__<index>` suffix from operation names before recording them, so the portfolio SystemStats operations table (and the CloudWatch OperationCount metric for portfolio/pantry/imposter) shows "Footer" instead of "Footer__portfolio__0". The federated query planner renames every subgraph-level operation this way for its own internal tracing, even for single-subgraph queries, which had also silently broken the plugin's IntrospectionQuery/TraceBreakdown/SystemStats ignore list.
- 30e3720: stop trace polling from declaring victory on platform-only segments
- b9ee226: replace Node @apollo/gateway with Apollo Router on Lambda
- 4303308: pin internal api-shared dependency by wildcard ("*") instead of an exact version, avoiding an intermittent npm ci resolution conflict against an unrelated public package of the same name
- ef08064: fix(portfolio,web): pretty-print the query sample and render the X-Ray trace breakdown as a real collapsible call tree

  The "Query" sample in the ops stats panel was rendering as one unbroken
  line - `GraphQLCode` now reformats it before syntax-highlighting.

  The "Trace" waterfall discarded X-Ray's real segment hierarchy when
  flattening subsegments into a list. `traceBreakdown` now returns each
  segment's `id`/`parentId` (remapped past the platform-Lambda dedup so a
  segment nested under the dropped duplicate doesn't become an orphaned
  root), and `TraceWaterfall` rebuilds the tree client-side, rendering it
  indented with a per-parent expand/collapse toggle instead of a flat list.

  Also fixes an unrelated bug found while testing this in dev: OperationRow's
  `unmounted` ref was only ever set `true` in its effect cleanup and never
  reset on mount, so React 18 StrictMode's dev-only mount/unmount/remount
  cycle permanently discarded every trace fetch after the first render.

- 30e3720: reduce cold-start latency: lazy-load AI/AWS-SDK-heavy resolver paths, bundle AWS SDK v3 instead of externalizing it
- Updated dependencies [fce1369]
- Updated dependencies [5e57e8f]
- Updated dependencies [0d1e57a]
  - api-shared@1.2.0

## 1.3.1

### Patch Changes

- cfa8fc5: refresh footer cost figures on a daily schedule, not per-request
- 0584cff: add CORS headers to actual Lambda responses, not just preflight
- Updated dependencies [0584cff]
  - api-shared@1.1.3

## 1.3.0

### Minor Changes

- 74ea629: Apollo Federation supergraph gateway, prod and test

### Patch Changes

- 518b10d: remove scheduled warmup ping, make PC scheduling per-project
- 9c5b5fd: migrate ApiGatewayStack from HTTP API to REST API for real X-Ray trace propagation
- Updated dependencies [2c53dce]
- Updated dependencies [9c5b5fd]
  - api-shared@1.1.2

## 1.2.1

### Patch Changes

- 342c866: add Vitest unit test suites across all workspaces
- Updated dependencies [342c866]
  - api-shared@1.1.1

## 1.2.0

### Minor Changes

- a806e6f: add per-operation-count metrics across all GraphQL services

### Patch Changes

- 3eec52f: class-based conversions across imposter, pantry, portfolio
- eca2441: Add the live petertran.au site as a "Website" link on the resume, alongside LinkedIn and GitHub.
- 7c8df31: extend X-Ray tracing to SES, Secrets Manager, Cost Explorer, and zero-trust-lab
- Updated dependencies [a806e6f]
- Updated dependencies [7c8df31]
  - api-shared@1.1.0

## 1.1.0

### Minor Changes

- bf58948: auto-generate a changeset from the PR title when one is missing
