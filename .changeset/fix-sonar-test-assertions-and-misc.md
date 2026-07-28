---
"web": patch
---

Restore explicit assertions dropped by an earlier find*-query conversion (SonarCloud S2699, BLOCKER), and fix 3 smaller regressions surfaced by a fresh SonarCloud scan: Number.NaN over NaN, a useState pair that collided names with a wrapping setter, and a stable per-row key for the imposter player list instead of array index
