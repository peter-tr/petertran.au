import * as AWSXRay from "aws-xray-sdk-core";
import { checkTrackedPrices } from "./lib/anthropic/check-prices";

// Separate entrypoint from handler.ts (the GraphQL Lambda) - invoked only by
// the API Lambda's fire-and-forget invoke from the "sync prices now" button
// (see lib/aws/sync-prices.ts). No automatic schedule and no per-item
// auto-trigger - both removed after a real credit-exhaustion incident, so
// this is the only way a price check runs. Same pattern as digest-handler.ts.
export async function handler(): Promise<void> {
  // Captured synchronously, as early as possible in the invocation - see
  // xray.ts's traced() for why this can't be looked up later.
  const xraySegment = process.env.AWS_LAMBDA_FUNCTION_NAME ? AWSXRay.getSegment() : undefined;
  await checkTrackedPrices(xraySegment);
}
