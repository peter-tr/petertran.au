import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FaLinkedin, FaGithub, FaFilePdf } from "react-icons/fa6";
import { runQuery, HERO_QUERY, type HeroQueryResult } from "../lib/graphql";
import type { Person } from "../lib/types";

const LINK_ICONS: Record<string, typeof FaLinkedin> = {
  LinkedIn: FaLinkedin,
  GitHub: FaGithub,
};

const QUERY_LINES = [
  "query Hero {",
  "  person { name }",
  "  experience(currentOnly: true) { role company }",
  "}",
];
const FULL_QUERY = QUERY_LINES.join("\n");

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface HeroProps {
  person: Person | null;
}

export default function Hero({ person }: HeroProps) {
  const [typed, setTyped] = useState(() => (prefersReducedMotion() ? FULL_QUERY : ""));
  const [typingDone, setTypingDone] = useState(prefersReducedMotion);
  const [result, setResult] = useState<{ name: string; role: string; company: string } | null>(null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion()) return;

    let i = 0;
    const interval = setInterval(() => {
      i += 1;
      setTyped(FULL_QUERY.slice(0, i));
      if (i >= FULL_QUERY.length) {
        clearInterval(interval);
        setTypingDone(true);
      }
    }, 14);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    runQuery<HeroQueryResult>(HERO_QUERY)
      .then((data) => {
        setResult({
          name: data.person.name,
          role: data.experience[0]?.role ?? "Software Engineer",
          company: data.experience[0]?.company ?? "",
        });
      })
      .catch(() => setErrored(true));
  }, []);

  const showResponse = typingDone && (result !== null || errored);
  const displayName = result?.name ?? person?.name ?? "Peter Tran";
  const displayRole = result?.role ?? "Backend Software Engineer";
  const displayCompany = result?.company ?? "Commonwealth Bank of Australia";

  return (
    <header className="hero">
      <p className="eyebrow">backend software engineer · sydney, australia</p>
      <h1>Peter Tran</h1>
      <p className="tagline">
        I grew up in Brisbane, studied software engineering at the University of Queensland, and now work on
        GraphQL federation at Commonwealth Bank in Sydney — before that, Boeing and Services Australia. I
        enjoy helping the people around me, and I'm always keen to learn something new.
      </p>

      <div className="terminal">
        <div className="terminal-bar">
          <span>hero.graphql</span>
          <span className="terminal-status">
            <span className={`dot ${showResponse && !errored ? "live" : ""}`} />
            {errored ? "offline" : showResponse ? "live" : "connecting…"}
          </span>
        </div>
        <div className="terminal-body">
          <p className="terminal-query">
            {typed}
            {!typingDone && <span className="cursor">&nbsp;</span>}
          </p>
          <div className={`terminal-response ${showResponse ? "show" : ""}`}>
            {errored ? (
              <span>// couldn&apos;t reach the API right now — try the explorer below in a moment</span>
            ) : (
              <>
                {"{"}
                <div>
                  &nbsp;&nbsp;<span className="key">"name"</span>:{" "}
                  <span className="str">"{displayName}"</span>,
                </div>
                <div>
                  &nbsp;&nbsp;<span className="key">"role"</span>:{" "}
                  <span className="str">"{displayRole}"</span>,
                </div>
                <div>
                  &nbsp;&nbsp;<span className="key">"company"</span>:{" "}
                  <span className="str">"{displayCompany}"</span>
                </div>
                {"}"}
              </>
            )}
          </div>
        </div>
      </div>

      <p className="section-hint">
        That's a real response, not a mock — the same schema is fully browsable below.{" "}
        <Link to="/#query">Try the query explorer →</Link>
      </p>

      {person && (
        <div className="hero-links" style={{ marginTop: "1.6rem" }}>
          {person.links.map((link) => {
            const Icon = LINK_ICONS[link.label];
            return (
              <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
                {Icon && <Icon aria-hidden="true" />}
                {link.label}
              </a>
            );
          })}
          <a href="/peter-tran-resume.pdf" target="_blank" rel="noreferrer">
            <FaFilePdf aria-hidden="true" />
            Resume (PDF)
          </a>
        </div>
      )}
    </header>
  );
}
