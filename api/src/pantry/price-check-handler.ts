import * as AWSXRay from "aws-xray-sdk-core";
import { checkTrackedPrices } from "./lib/anthropic/check-prices";
import { DEFAULT_PK } from "./context";

// Separate entrypoint from handler.ts (the GraphQL Lambda) - invoked only by
// the API Lambda's fire-and-forget invoke from the "sync prices now" button
// (see lib/aws/sync-prices.ts), scoped to whichever pantry clicked it (`pk`
// in the invoke payload). No automatic schedule and no per-item auto-trigger
// - both removed after a real credit-exhaustion incident - and deliberately
// NOT looped over every registered user the way digest-handler.ts is: this
// runs real (billed) Anthropic calls, so one user's click must never fan out
// into a price check for every other pantry too.
export async function handler(event: { pk?: string } = {}): Promise<void> {
  // Captured synchronously, as early as possible in the invocation - see
  // xray.ts's traced() for why this can't be looked up later.
  const xraySegment = process.env.AWS_LAMBDA_FUNCTION_NAME ? AWSXRay.getSegment() : undefined;
  await checkTrackedPrices(event.pk ?? DEFAULT_PK, xraySegment);
}
