---
"supergraph": patch
---

Fix a batch of SonarCloud code-smell findings in supergraph: pin build-router-package.ts's `tar` invocation to an absolute path instead of relying on PATH lookup (S4036), and convert its top-level async-IIFE wrapper to top-level await (S7785).
