import { checkTrackedPrices, type PriceCheckTarget } from "./lib/anthropic/check-prices";

interface PriceCheckEvent {
  only?: PriceCheckTarget;
}

// Separate entrypoint from handler.ts (the GraphQL Lambda) - this one is
// invoked directly by an EventBridge Scheduler schedule (no payload, checks
// everything tracked) or by the API Lambda's fire-and-forget invoke (see
// lib/aws/sync-prices.ts), which may include `only` to scope the run to a
// single just-toggled item instead. Same pattern as digest-handler.ts.
export async function handler(event: PriceCheckEvent | null | undefined): Promise<void> {
  await checkTrackedPrices(event?.only);
}
