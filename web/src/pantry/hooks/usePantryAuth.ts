import { useCallback, useEffect, useState } from "react";
import { runPantryQuery, ME_QUERY, type MeResult } from "../api";
import { signIn, signUp, signOut as authSignOut, PantryAuthError } from "../lib/auth";

export type PantryAuthMode = "signin" | "signup";

// Drives the pantry header's account indicator + inline sign-in/sign-up
// form - null email means "using the default/shared pantry" (either never
// signed in, or signed out), exactly like Query.me itself.
export function usePantryAuth() {
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    return runPantryQuery<MeResult>(ME_QUERY)
      .then((res) => setEmail(res.me?.email ?? null))
      .catch(() => setEmail(null));
  }, []);

  useEffect(() => {
    refetch().finally(() => setReady(true));
  }, [refetch]);

  const submit = useCallback(
    async (mode: PantryAuthMode, emailInput: string, password: string): Promise<boolean> => {
      setPending(true);
      setError(null);
      try {
        if (mode === "signup") await signUp(emailInput, password);
        else await signIn(emailInput, password);
        await refetch();

        return true;
      } catch (err) {
        setError(err instanceof PantryAuthError ? err.message : "Something went wrong. Try again.");

        return false;
      } finally {
        setPending(false);
      }
    },
    [refetch]
  );

  const signOut = useCallback(() => {
    authSignOut();
    setEmail(null);
  }, []);

  return { email, ready, pending, error, submit, signOut };
}
