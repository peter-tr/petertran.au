---
"api": patch
---

Fix a batch of SonarCloud code-smell findings in root api/ scripts: resolve e2e-smoke.ts's `tsx` PATH-lookup lint (S4036) via Node module resolution, convert e2e-smoke.ts's async wrapper to top-level await (S7785), reduce warm-schedule/handler.ts's `processEvent` cognitive complexity by extracting per-event-type handlers (S3776), and extract a nested ternary in zero-trust-lab/edge/proxy.ts into a lookup table (S3358).
