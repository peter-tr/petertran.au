import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
// Footer lives here (not portfolio/components) since pantry/notes/imposter
// all render it too, but the cost query still goes through portfolio's
// GraphQL client/schema - the "total cost since launch" is a genuine
// site-wide figure that portfolio's `meta` resolver owns, not per-project data.
import { runQuery, FOOTER_QUERY, type FooterQueryResult } from "../../portfolio/lib/graphql";
import { useShowFooterCost } from "../hooks/useShowFooterCost";

type Cost = FooterQueryResult["meta"];

export default function Footer({ email }: { email?: string }) {
  const [cost, setCost] = useState<Cost | null>(null);
  const { showFooterCost } = useShowFooterCost();

  // Skipped entirely when the cost line is toggled off - this query only
  // exists to fetch the cost figures, so there's no call to make.
  useEffect(() => {
    if (!showFooterCost) return;

    runQuery<FooterQueryResult>(FOOTER_QUERY)
      .then((result) => setCost(result.meta))
      .catch(() => {});
  }, [showFooterCost]);

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
        · <Link to="/notes">experiments</Link>
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
