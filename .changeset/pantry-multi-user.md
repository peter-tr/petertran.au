---
"pantry": minor
"api-shared": minor
"infra": minor
"web": minor
---

add multi-user support to pantry: sign in via a new Cognito Hosted UI pool to get a private inventory/shopping list/settings, scoped by `pk`. Anyone not signed in keeps using the existing shared/default pantry unchanged.
