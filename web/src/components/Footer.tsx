import { useEffect, useState } from "react";
import { runQuery, FOOTER_QUERY, type FooterQueryResult } from "../lib/graphql";

type Cost = FooterQueryResult["meta"];

export default function Footer({ email }: { email?: string }) {
  const [cost, setCost] = useState<Cost | null>(null);

  useEffect(() => {
    runQuery<FooterQueryResult>(FOOTER_QUERY)
      .then((result) => setCost(result.meta))
      .catch(() => {});
  }, []);

  return (
    <footer className="footer">
      <span>
        © 2026 Peter Tran ·{" "}
        <a href={`mailto:${email ?? "peter2002tran@outlook.com"}`}>{email ?? "peter2002tran@outlook.com"}</a>
      </span>
      <span>
        <a href="https://github.com/peter-tr/petertran.au" target="_blank" rel="noreferrer">
          source
        </a>{" "}
        · built with AWS CDK · Lambda · DynamoDB · CloudFront
        {cost && (
          <>
            {" "}
            · real cost this month: ${cost.totalCostUsd.toFixed(4)} (AWS ${cost.awsCostUsd.toFixed(4)} +
            Anthropic ${cost.anthropicCostUsd.toFixed(4)})
          </>
        )}
      </span>
    </footer>
  );
}
