import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import type { PriceCheckTarget } from "../anthropic/check-prices";

const lambda = new LambdaClient({});

// Fire-and-forget invoke of the price-check Lambda (see price-check-handler.ts
// / lib/anthropic/check-prices.ts) - InvocationType "Event" returns as soon
// as AWS has accepted the invoke, not once it's finished, so this resolves
// in milliseconds regardless of how many tracked items there are. Results
// land on each item's lastKnownPrice the same way the scheduled run's do.
//
// `only` scopes the run to a single item (e.g. just-toggled trackPrice) -
// omit it for the bulk paths (daily schedule, "sync prices now") that
// deliberately check everything tracked.
export async function triggerPriceSync(only?: PriceCheckTarget): Promise<void> {
  const functionName = process.env.PRICE_CHECK_FUNCTION_NAME;
  if (!functionName) {
    throw new Error("PRICE_CHECK_FUNCTION_NAME not configured.");
  }

  await lambda.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "Event",
      Payload: only ? JSON.stringify({ only }) : undefined,
    })
  );
}
