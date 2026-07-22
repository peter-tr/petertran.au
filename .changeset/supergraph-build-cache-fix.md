---
"api": patch
---

fix supergraph's build cache never invalidating when a subgraph's schema.graphql changes - `supergraph.generated.ts` is gitignored, so turbo's default `$TURBO_DEFAULT$` input tracking never saw it change, and `dependsOn` alone doesn't make a task's cache key depend on an upstream task's output content. This let a stale composed schema (missing the newly-merged `saveAsTemplate` mutation) ship to production even though CI and the deploy both reported success. Disabling caching for `supergraph#codegen` and `supergraph#build` forces both to always run instead of relying on unreliable cross-package input tracking.
