import { useEffect, useState } from "react";
import { runQuery, FOOTER_QUERY, type FooterQueryResult } from "../lib/graphql";
import { useShowFooterCost } from "../hooks/useShowFooterCost";

type Cost = FooterQueryResult["meta"];

export default function Footer({ email, staggerDelayMs = 0 }: { email?: string; staggerDelayMs?: number }) {
  const [cost, setCost] = useState<Cost | null>(null);
  const { showFooterCost } = useShowFooterCost();

  // staggerDelayMs (see Home.tsx/useStaggerHomeFetches) lets Hero's request
  // land first and claim a warm portfolio-graphql slot before this one fires.
  // Skipped entirely when the cost line is toggled off - this query only
  // exists to fetch the cost figures, so there's no call to make.
  useEffect(() => {
    if (!showFooterCost) return;

    const timer = setTimeout(() => {
      runQuery<FooterQueryResult>(FOOTER_QUERY)
        .then((result) => setCost(result.meta))
        .catch(() => {});
    }, staggerDelayMs);

    return () => clearTimeout(timer);
  }, [staggerDelayMs, showFooterCost]);

  // `email` lets a caller that already has resume data (Resume.tsx) pass it
  // through directly; everyone else gets the hardcoded default.
  const displayEmail = email ?? "peter2002tran@outlook.com";

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
        {cost && showFooterCost && (
          <>
            {" "}
            · real cost since launch: ${cost.totalCostUsd.toFixed(4)} (AWS ${cost.awsCostUsd.toFixed(4)},
            within the $200 AWS Free Tier credit + Anthropic ${cost.anthropicCostUsd.toFixed(4)})
          </>
        )}
      </span>
    </footer>
  );
}
