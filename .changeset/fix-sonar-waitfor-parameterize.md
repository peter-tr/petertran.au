---
"web": patch
"design-studio": patch
---

Replace waitFor+getBy/queryBy with find* queries in several test files (SonarCloud S9020), and collapse 8 near-identical portfolio-query-allowlist rejection tests into a single parameterized it.each block (S9020/S5976 cleanup, test-only changes)
