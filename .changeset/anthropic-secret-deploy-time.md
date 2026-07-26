---
"infra": patch
---

resolve the Anthropic API key(s) into Lambda env vars at deploy time instead of fetching from Secrets Manager at runtime

X-Ray traces showed a ~300ms median (p99 ~1.7s) `GetSecretValue` round trip on every cold start that touched `getAnthropicClient()`/`getAnthropicAdminApiKey()`, and cold starts turned out to be 13-25% of invocations across portfolio/pantry/imposter/design-studio over a 7-day sample - not the rare case the runtime-fetch design assumed. `ANTHROPIC_API_KEY`/`ANTHROPIC_ADMIN_API_KEY` are now resolved via `secretValue.unsafeUnwrap()` (a CloudFormation dynamic reference resolved at deploy time), the same pattern `design-studio-stack.ts` already used for `MONGO_URI`. No application code changes needed - both `anthropic-client.ts` and `anthropic-cost.ts` already preferred a direct env var over the Secrets Manager fallback. Confirmed live: zero `SecretsManager` subsegments across all four Lambdas' first (cold) invocations post-deploy.
