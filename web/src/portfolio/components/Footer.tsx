import { useEffect, useState } from "react";
import { runQuery, FOOTER_QUERY, type FooterQueryResult } from "../lib/graphql";

type Cost = FooterQueryResult["meta"];

export default function Footer({ email }: { email?: string }) {
  const [cost, setCost] = useState<Cost | null>(null);
  const [fetchedEmail, setFetchedEmail] = useState<string | null>(null);

  useEffect(() => {
    runQuery<FooterQueryResult>(FOOTER_QUERY)
      .then((result) => {
        setCost(result.meta);
        setFetchedEmail(result.person.email);
      })
      .catch(() => {});
  }, []);

  // `email` lets a caller that already has resume data (Resume.tsx) skip
  // waiting on Footer's own fetch; pages without it (Home.tsx) fall back to
  // Footer's query, then the hardcoded default while that's in flight.
  const displayEmail = email ?? fetchedEmail ?? "peter2002tran@outlook.com";

  return (
    <footer className="footer">
      <span>
        © 2026 Peter Tran · <a href={`mailto:${displayEmail}`}>{displayEmail}</a>
      </span>
      <span>
        <a href="https://github.com/peter-tr/petertran.au" target="_blank" rel="noreferrer">
          source
        </a>{" "}
        · built with AWS CDK · Lambda · DynamoDB · CloudFront
        {cost && (
          <>
            {" "}
            · real cost since launch: ${cost.totalCostUsd.toFixed(4)} (AWS ${cost.awsCostUsd.toFixed(4)} +
            Anthropic ${cost.anthropicCostUsd.toFixed(4)})
          </>
        )}
      </span>
    </footer>
  );
}
