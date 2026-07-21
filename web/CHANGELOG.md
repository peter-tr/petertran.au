# web

## 1.3.0

### Minor Changes

- 1984776: add supergraph to scheduled provisioned concurrency
- 74ea629: Apollo Federation supergraph gateway, prod and test

### Patch Changes

- 649a852: bootstrap prod's supergraph rollout in two steps
- 76e148e: stop warm-schedule deploys from wiping live settings, fix save UX
- 518b10d: remove scheduled warmup ping, make PC scheduling per-project
- b451168: run web prerender after infra deploy, not before
- 4165ddd: rename pc-config to warm-schedule for clarity
- 0da41b5: cut prod frontend over to the supergraph endpoint; raise the supergraph
  handler test's timeout for a cold CI cache

## 1.2.0

### Minor Changes

- 553f6a6: scheduled Provisioned Concurrency for portfolio/pantry/imposter + zero-trust-lab
- 8856b38: add Playwright visual e2e tests for portfolio/pantry/imposter

### Patch Changes

- 342c866: add Vitest unit test suites across all workspaces

## 1.1.0

### Minor Changes

- 36fcc26: add shared API Gateway in front of portfolio/pantry/imposter/warmup
- ac54c28: add on-demand test environment for safe big-change testing

### Patch Changes

- 05aeac4: memoize activeOperations to satisfy exhaustive-deps

## 1.0.2

### Patch Changes

- f183a4d: commit local dev API endpoints as .env.development

## 1.0.1

### Patch Changes

- 588dd41: document and suppress the intentional missing-deps warning
