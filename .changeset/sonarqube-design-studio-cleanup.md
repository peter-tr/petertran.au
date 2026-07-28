---
"design-studio": patch
---

Fix a batch of SonarCloud code-smell findings in design-studio: reduce cognitive complexity in supergraph-tool.ts's `gatherSupergraphContext` by extracting a `resolveToolUseBlock` helper (S3776), convert seed-templates.ts's top-level-await-eligible script from an async-IIFE wrapper (S7785), and simplify a ternary to `Math.max` in generate-elements.ts (S7766).
