# zero-trust-lab

A personal learning exercise: an **edge gateway** that accepts an opaque
token, exchanges it via an **internal STS** for a short-lived, audience-scoped
JWT, and a **domain gateway** that independently verifies that JWT before
reaching a backend - the "phantom token" pattern. Built as a real, deployable
AWS stack (`infra/lib/zero-trust-lab-stack.ts`), not a diagram, and
deliberately isolated from the real site: own Cognito User Pool, own
DynamoDB table, own HttpApis, own everything.

## Why

Edge/domain gateway separation with opaque-at-the-edge / JWT-on-the-inside is
a real enterprise pattern (sometimes called the Phantom Token Pattern) - this
exists to build hands-on intuition for it: what actually enforces the trust
boundary, where the interesting AWS platform gotchas are, and what it costs.

## Architecture

```
Client
  │  Authorization: Bearer <opaque>
  ▼
Edge HttpApi  (/domain-a/{proxy+})
  │
  ├─ Lambda authorizer (EdgeAuthorizerFunction)
  │     1. extract opaque token
  │     2. call IdpBridge  POST /introspect
  │     3. direct-Invoke InternalSts (IAM-only, no network hop)
  │        { claims, audience: "domain-a", issuer } -> { jwt }
  │
  ▼
EdgeProxyFunction - forwards to Domain-A with Authorization: Bearer <jwt>
  ▼
Domain-A HttpApi
  - native HTTP API JWT authorizer (no Lambda) - validates signature, iss,
    aud, exp against InternalSts's JWKS
  ▼
DomainAFunction - returns the validated claims
```

**External identity**: Amazon Cognito User Pool + Hosted UI - real password
storage, a ready-made login page, no hand-rolled credential handling. A thin
`IdpBridgeFunction` receives the OAuth callback, exchanges the code once, and
mints this lab's own long-lived opaque token (bound to the Cognito identity,
stored in DynamoDB) - the browser only ever holds _that_, never a Cognito
token directly.

**Internal signer**: `InternalStsFunction` mints RS256 JWTs using a KMS
asymmetric key (`kms:Sign` - the private key never leaves KMS). RSA, not EC:
KMS's RSA signature bytes are usable as a JWS signature directly, no
DER-to-raw conversion needed.

## Real gotchas hit building this (not hypothetical)

- **CloudFormation circular dependencies**: a Lambda can't hold its own
  Function URL (or anything that depends on it) in its own environment
  variables - `FunctionUrl` depends on the `Function`, so the `Function`'s
  properties can't depend back on `FunctionUrl`. Fixed by deriving
  issuer/callback URLs from the incoming request's `domainName` at runtime
  instead, and looking up Cognito's client secret via the API at runtime
  rather than wiring it through CDK.
- **HTTP API's native JWT authorizer requires full OIDC discovery** - it
  fetches `<issuer>/.well-known/openid-configuration`, not a bare JWKS URL.
- **Lambda Function URLs base64-encode the request body** under some
  conditions (plain `curl -d` reproduces it) - `JSON.parse(event.body)`
  without checking `isBase64Encoded` breaks silently.
- **`scheduler:UpdateSchedule` also needs `iam:PassRole`** on the schedule's
  target execution role, not just permission on the schedule resource itself.

## What's verified (real AWS, not mocked)

Full chain tested end to end against the live deployment: Cognito Hosted UI
login (one-time) → opaque token → edge introspection → direct-invoke exchange
→ KMS-signed JWT → Domain-A's native JWT authorizer validates it with zero
application code → revocation (`/logout` deletes the DynamoDB row → next
request denied immediately, no caching).

Measured, not estimated: cold end-to-end latency ≈3.6-3.7s (cold starts
compound across the chain - each hop's own Init time is nested inside the
next hop's Duration), warm ≈950ms-1s (still higher than typical same-region
Lambda-to-Lambda because nothing here is connection-pooled or VPC-colocated -
every hop is a real public HTTPS call, which is the direct cost of the
security properties, not overhead to optimize away).

## What's deferred

- **Domain-B / audience-rejection proof.** A second domain gateway to
  concretely demonstrate that a JWT minted for `aud: "domain-a"` is rejected
  at a different domain - the plumbing already supports it (`audienceForPath`
  in `edge/authorizer.ts` already recognizes `/domain-b`), just not built.
- **Real pantry integration.** Swapping Domain-A's backend for pantry's
  actual Lambda (currently a placeholder that echoes claims) so this
  actually gates something real, with pantry's existing Function URL kept as
  a fallback until the gateway path is trusted.
- **`Domain-Warmup` behind real auth.** Instead of the warmup toggle being a
  public, unauthenticated endpoint (see below), route it through this same
  edge/domain gateway chain as a second domain - gives Domain-B a genuine
  purpose instead of an artificial stub, and means only an authenticated
  owner (via Cognito login) can flip it, not any site visitor. Requires
  adding a real login affordance to the portfolio site, which is why this is
  deferred rather than built alongside everything else.

## Related: the warmup system

Cold starts on this lab's 5 Lambdas (plus portfolio/pantry/imposter's) led to
a separate, cross-project keep-warm system - see `PetertranWarmupStack`
(`infra/lib/warmup-stack.ts`). Deliberately **not** part of this stack:
warming is an operational/cost concern that applies equally to every
project's Lambdas, not something specific to the zero-trust pattern this
stack exists to teach. See `CLAUDE.md`'s "Learning-exercise / ops peer
projects" section for where its code lives.
