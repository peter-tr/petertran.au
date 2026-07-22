---
"imposter": patch
"pantry": patch
"portfolio": patch
---

pin internal api-shared dependency by wildcard ("*") instead of an exact version, avoiding an intermittent npm ci resolution conflict against an unrelated public package of the same name
