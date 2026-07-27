---
"infra": minor
---

add a WAF rate-based rule (per-IP, COUNT mode) to the shared API Gateway stage

The app-level DynamoDB rate limiters (`api-shared/rate-limit`) reject a request only after it's already paid for a full Lambda invocation and a DynamoDB write - a WAF rate-based rule rejects at the edge, before either happens, but can't see GraphQL operation names to differentiate cost, so this is additive to those limiters, not a replacement. `ApiGatewayStack` now provisions a regional `AWS::WAFv2::WebACL` with one rate-based rule (100 req/IP/60s, `Count` action, not `Block`) associated with the RestApi's deployment stage, covering every route behind it (portfolio/pantry/imposter/supergraph/design-studio) in one place. Deliberately starts in COUNT rather than BLOCK - the 100/min threshold is a starting point, not validated against real traffic yet; flipping the rule's `action` to `Block` is a follow-up change once the `RateLimitByIp` CloudWatch metric shows what real usage looks like.
