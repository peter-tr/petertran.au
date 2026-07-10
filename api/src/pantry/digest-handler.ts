import { sendShoppingListDigest } from "./lib/aws/send-digest";

// Separate entrypoint from handler.ts (the GraphQL Lambda) - this one is
// invoked directly by an EventBridge Scheduler schedule, not through the
// Function URL, so it has no GraphQL/HTTP wiring at all.
export async function handler(): Promise<void> {
  await sendShoppingListDigest();
}
