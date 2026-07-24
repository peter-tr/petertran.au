---
"infra": patch
---

fix(pantry): drop `standardAttributes` from PantryUserPool - it modifies Cognito's User Pool `Schema`, which the `UpdateUserPool` API doesn't support changing on an existing pool. Deploying PR #151 failed on this (`Invalid AttributeDataType input`) and rolled back cleanly; email is already implied by `signInAliases: { email: true }`, so the prop was redundant anyway.
