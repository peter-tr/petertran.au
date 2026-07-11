import { checkTrackedPrices } from "./lib/anthropic/check-prices";

// Separate entrypoint from handler.ts (the GraphQL Lambda) - this one is
// invoked directly by an EventBridge Scheduler schedule, not through the
// Function URL, so it has no GraphQL/HTTP wiring at all. Same pattern as
// digest-handler.ts.
export async function handler(): Promise<void> {
  await checkTrackedPrices();
}
