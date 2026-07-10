import { useEffect, useState } from "react";
import { runQuery, RESUME_QUERY } from "../lib/graphql";
import type { ResumeData } from "../lib/types";

// Resume data barely ever changes, so cache the in-flight/resolved fetch at
// module scope - re-mounting the route (nav away and back) reuses it instead
// of re-fetching over the network. A full page reload naturally clears it,
// which is enough invalidation for data that changes this rarely.
let cachedFetch: Promise<ResumeData> | null = null;

function fetchResumeData(): Promise<ResumeData> {
  if (!cachedFetch) {
    cachedFetch = runQuery<ResumeData>(RESUME_QUERY).catch((err) => {
      cachedFetch = null; // don't cache a failure - let the next mount retry
      throw err;
    });
  }
  return cachedFetch;
}

export function useResumeData() {
  const [data, setData] = useState<ResumeData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchResumeData()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, []);

  return { data, error };
}
