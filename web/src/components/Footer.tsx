export default function Footer({ email }: { email?: string }) {
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
      </span>
    </footer>
  );
}
