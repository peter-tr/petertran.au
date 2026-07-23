import { useCallback, useEffect, useState } from "react";
import { runPantryQuery, ME_QUERY, type MeResult } from "../api";
import { completeSignInIfNeeded, beginSignIn, signOut } from "../lib/auth";

// Drives the pantry header's account indicator - null email means "using
// the default/shared pantry" (either never signed in, or signed out),
// exactly like Query.me itself. completeSignInIfNeeded is a no-op unless
// the URL has an OAuth ?code= from just finishing Hosted UI sign-in, in
// which case it exchanges it for tokens before this hook's first `me` fetch
// - so a fresh sign-in shows the right account on the very first render
// rather than a flash of "signed out".
export function usePantryAuth() {
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const refetch = useCallback(() => {
    return runPantryQuery<MeResult>(ME_QUERY)
      .then((res) => setEmail(res.me?.email ?? null))
      .catch(() => setEmail(null));
  }, []);

  useEffect(() => {
    completeSignInIfNeeded()
      .then(refetch)
      .finally(() => setReady(true));
  }, [refetch]);

  return { email, ready, signIn: beginSignIn, signOut };
}
