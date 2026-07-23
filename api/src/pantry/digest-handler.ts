import { sendShoppingListDigest } from "./lib/aws/send-digest";
import { listAllPantryPks } from "./services/users";

// Separate entrypoint from handler.ts (the GraphQL Lambda) - this one is
// invoked directly by an EventBridge Scheduler schedule, not through the
// Function URL, so it has no GraphQL/HTTP wiring at all. Runs once per
// registered pantry (the shared default plus every signed-up user) - see
// services/users.ts's listAllPantryPks.
export async function handler(): Promise<void> {
  for (const pk of await listAllPantryPks()) {
    await sendShoppingListDigest(pk);
  }
}
