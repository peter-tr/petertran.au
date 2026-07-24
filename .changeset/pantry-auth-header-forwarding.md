---
"api": patch
"infra": patch
---

fix(pantry): forward the authorization header through the API Gateway CORS allowlist and the supergraph gateway to subgraphs - two separate bugs meant a signed-in pantry request never actually reached the pantry Lambda authenticated: the browser's CORS preflight rejected `authorization` outright (it wasn't in the gateway's `Access-Control-Allow-Headers`), and even past that, `RemoteGraphQLDataSource` doesn't forward the original request's headers to a subgraph on its own - the supergraph handler now copies it from context in `willSendRequest`. Verified against the live deployed API: `ensureAccount`/`me` returned "Not signed in."/`null` for a valid Cognito token before this fix, and the account's own id/email after it.
