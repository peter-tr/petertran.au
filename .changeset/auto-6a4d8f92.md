---
"imposter": patch
---

fix(imposter): build Lambda bundle as CommonJS instead of ESM, bundle AWS SDK v3 instead of externalizing

Same ESM->CJS cold-start fix as pantry/portfolio (see pantry's changeset
for the measured numbers). Also drops `external: ["@aws-sdk/*"]`, matching
the fix already applied to pantry/portfolio earlier this cycle - relying on
the Lambda runtime's built-in SDK copy added dynamic-linking overhead at
Init time; bundling an explicit pinned copy avoided it.
