import { getAwsAllTimeCostUsd } from "./lib/aws/aws-cost";
import { getAnthropicAllTimeCostUsd } from "./lib/anthropic/anthropic-cost";

// Separate entrypoint from handler.ts (the GraphQL Lambda) - invoked
// directly by an EventBridge Scheduler schedule, not through the API
// Gateway route, so it has no GraphQL/HTTP wiring at all. Same pattern as
// pantry's digest-handler.ts.
//
// Proactively refreshes both footer cost figures once a day so a real
// visitor's request is never the one that pays for the (slow, occasionally
// timing-out) upstream fetch - Anthropic's cost report alone can take a
// dozen-odd sequential requests for a 12-month lookback, and one real
// request ended up blocked for ~17s waiting on it. getAwsAllTimeCostUsd/
// getAnthropicAllTimeCostUsd already no-op when their own DynamoDB cache is
// still fresh, so calling both unconditionally here is cheap and safe even
// if this schedule ever fires more often than the cache's TTL. The
// request-path fetch these two functions still do on a cache miss stays in
// place as a backstop (e.g. this schedule missing a day) - it just stops
// being the primary path.
export async function handler(): Promise<void> {
  await Promise.allSettled([getAwsAllTimeCostUsd(), getAnthropicAllTimeCostUsd()]);
}
