---
"api-shared": patch
---

Fix a batch of SonarCloud code-smell findings in api-shared: rewrite two backtracking-prone regexes in operation-metrics.ts and cognito-auth.ts to linear equivalents (S8786), and convert http.ts's `ALLOWED_ORIGINS` array to a `Set` (S7776).
