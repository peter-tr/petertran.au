---
"api": patch
---

add shared api/scripts/build-lambda.ts helper for CJS Lambda bundling

New shared build-time helper (`buildCjsLambdas()`) used by portfolio,
pantry, imposter, and design-studio's own build scripts - see each
project's own changeset for what it does and why.
