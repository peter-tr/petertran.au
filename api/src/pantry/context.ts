import type { Context as SharedContext } from "api-shared/context";

// Everyone who's never signed in shares this one partition - today's
// behavior, preserved unchanged as the fallback for any request with no
// (or an invalid) ID token.
export const DEFAULT_PK = "PANTRY";

export function pkForUser(userId: string | null): string {
  return userId ? `USER#${userId}` : DEFAULT_PK;
}

export interface Context extends SharedContext {
  // Which DynamoDB partition this request's resolvers/services should read
  // and write - DEFAULT_PK for an unauthenticated request, "USER#<sub>" for
  // a signed-in one. Computed once, server-side, from the verified ID token
  // - never trust a client-supplied user id.
  pantryPk: string;
  userId: string | null;
  email: string | null;
}
