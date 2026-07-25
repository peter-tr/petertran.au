---
"portfolio": patch
---

fix(portfolio): build Lambda bundle as CommonJS instead of ESM to fix ADOT cold-start regression

Same fix as pantry (see its changeset for the measured before/after
numbers) - ESM's import-in-the-middle instrumentation hook under the ADOT
layer was responsible for most of this project's ~3.7s cold starts.
