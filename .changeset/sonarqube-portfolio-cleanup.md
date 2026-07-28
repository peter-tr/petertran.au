---
"portfolio": patch
---

Fix a batch of SonarCloud code-smell findings in portfolio: convert dev/seed.ts's top-level-await-eligible script from an async-IIFE wrapper (S7785), consolidate system-stats.ts's `applyTo` helper's parameters into a single sample object (S107), move an in-place `.sort()` in xray.ts to its own statement so it's not called misleadingly mid-expression (S4043), rewrite a backtracking-prone email-validation regex in contact.ts to a linear equivalent (S8786), and replace a ternary with `??` in cached-cost-fetcher.ts (S6606).
