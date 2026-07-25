---
"infra": patch
---

fix(infra): suffix pantry's auto-confirm Lambda name for the test env

`PantryAutoConfirmFunction` (the Cognito PreSignUp trigger backing
pantry's frictionless sign-up) had a hardcoded `functionName:
"pantry-auto-confirm"`, unlike every other named resource in
`pantry-stack.ts` - missed when this trigger was added. Surfaced as a real
deploy failure: `PetertranTestPantryStack` tried to create a Lambda with
that same literal name and collided with prod's already-existing one
(Lambda function names are unique per account/region). Now suffixed
`-test` in the test env, matching the rest of the stack.
