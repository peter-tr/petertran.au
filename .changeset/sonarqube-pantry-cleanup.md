---
"pantry": patch
---

Fix a batch of SonarCloud code-smell findings in pantry: reduce cognitive complexity in check-prices.ts's `checkTrackedPrices` and parse-command.ts's `parseCommand`/`toProposedAction` by extracting helper functions (S3776), consolidate `upsertShoppingListEntry`'s and `parseCommand`'s parameters into options objects (S107, keeping the dev-mock counterpart's signature consistent), rewrite a backtracking-prone regex and simplify a `&&` chain to optional chaining in check-prices.ts (S8786/S6582), and extract nested ternaries/template literals in check-prices.ts, parse-command.ts, and send-digest.ts into named variables (S3358/S4624).
