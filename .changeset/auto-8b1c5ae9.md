---
"pantry": patch
---

fix(pantry): build Lambda bundle as CommonJS instead of ESM to fix ADOT cold-start regression

ESM auto-instrumentation (import-in-the-middle) under the ADOT/Application
Signals layer added ~3s to every cold start vs. CommonJS's
require-in-the-middle - confirmed via live A/B testing against a throwaway
Lambda with the real bundle, real IAM config, and real GraphQL requests
(~3.7s ESM vs. ~890ms CJS, consistent across 6 samples). No source changes;
`api/scripts/build-lambda.ts`'s `buildCjsLambdas()` now builds each entry
as a bundled CJS file plus a thin unbundled wrapper (working around an
esbuild/OTel interop bug where non-configurable CJS export getters crash
require-in-the-middle's monkey-patching).
