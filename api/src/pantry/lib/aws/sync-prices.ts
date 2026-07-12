import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const lambda = new LambdaClient({});

// Fire-and-forget invoke of the price-check Lambda (see price-check-handler.ts
// / lib/anthropic/check-prices.ts) - InvocationType "Event" returns as soon
// as AWS has accepted the invoke, not once it's finished, so this resolves
// in milliseconds regardless of how many tracked items there are. Results
// land on each item's lastKnownPrice the same way once the batch finishes.
//
// Only ever called from the "sync prices now" settings button - there's no
// automatic schedule and no per-toggle auto-trigger (both removed after a
// real credit-exhaustion incident); this is the only way a price check runs.
export async function triggerPriceSync(): Promise<void> {
  const functionName = process.env.PRICE_CHECK_FUNCTION_NAME;
  if (!functionName) {
    throw new Error("PRICE_CHECK_FUNCTION_NAME not configured.");
  }

  await lambda.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "Event",
    })
  );
}
