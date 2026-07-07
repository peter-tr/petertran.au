import { useEffect, useState } from "react";
import { runQuery, FOOTER_QUERY, type FooterQueryResult } from "../lib/graphql";

export default function Footer({ email }: { email?: string }) {
  const [costUsd, setCostUsd] = useState<number | null>(null);

  useEffect(() => {
    runQuery<FooterQueryResult>(FOOTER_QUERY)
      .then((result) => setCostUsd(result.meta.awsCostUsd))
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
        {costUsd !== null && <> · real AWS cost this month: ${costUsd.toFixed(4)}</>}
      </span>
    </footer>
  );
}
