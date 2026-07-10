import { useEffect, useState } from "react";
import { runQuery, RESUME_QUERY } from "../lib/graphql";
import type { ResumeData } from "../lib/types";

export function useResumeData() {
  const [data, setData] = useState<ResumeData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    runQuery<ResumeData>(RESUME_QUERY)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, []);

  return { data, error };
}
