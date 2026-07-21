import { useState, type ReactNode } from "react";
import Footer from "../portfolio/components/Footer";
import ZeroTrustDiagram from "./components/ZeroTrustDiagram";
import "./notes.css";

interface NoteEntry {
  slug: string;
  railLabel: string;
  title: string;
  date: string;
  tags: string[];
  body: ReactNode;
}

// Static and hand-written, not DB-backed - short enough that a data store
// would be more machinery than the content justifies. Newest first, like a
// log.
const ENTRIES: NoteEntry[] = [
  {
    slug: "warmup-scheduling",
    railLabel: "Warmup: pings vs provisioned concurrency",
    title: "Keeping Lambdas warm: ping-on-load, scheduled ping, then provisioned concurrency",
    date: "2026-07-21",
    tags: ["lambda", "cold-starts", "eventbridge", "provisioned-concurrency"],
    body: (
      <>
        <p>
          Three approaches, tried in order. <strong>Ping on page load:</strong> the homepage fires a
          background warmup invoke at Pantry's and Imposter's Lambdas as soon as it mounts - tightly timed to
          real navigation, but does nothing for the day's first visitor.
        </p>
        <p>
          <strong>Scheduled ping, every 10 minutes:</strong> an EventBridge schedule kept every Lambda warm
          around the clock regardless of traffic. Bisecting the real idle-reclaim window (invoke, wait N,
          invoke again, read <code>Init Duration</code> off the REPORT line) against zero-trust-lab's Lambdas
          - which get literally zero organic traffic, so every cold invocation there is real - found it's
          actually <strong>~2m10s-3m20s</strong>, nowhere near the commonly-cited 5-45 minutes. A 10-min ping
          was already cutting it close.
        </p>
        <p>
          <strong>Provisioned concurrency, business hours only:</strong> removed the scheduled ping entirely
          for portfolio/pantry/imposter and moved them onto PC via a <code>live</code> alias instead, each
          toggleable from Settings.
        </p>
        <div className="note-table-wrap">
          <table className="note-table">
            <thead>
              <tr>
                <th>Approach</th>
                <th>Coverage</th>
                <th>Cost (3 fns)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Ping on page load</td>
                <td>Only after a real visit lands</td>
                <td>~$0</td>
                <td>Still active, on top of PC</td>
              </tr>
              <tr>
                <td>Scheduled ping (10 min)</td>
                <td>24/7, ~2-3 min reclaim margin</td>
                <td>negligible</td>
                <td>Removed 2026-07-21</td>
              </tr>
              <tr>
                <td>Provisioned concurrency</td>
                <td>8am-7pm Australia/Sydney</td>
                <td>~$4.73/mo (~$10.32/mo if 24/7)</td>
                <td>Current, per-project toggle</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          zero-trust-lab deliberately stayed on the old scheduled ping - its 5 Lambdas get no real visitors
          for PC to protect, and the ping already costs a combined <strong>~$0.036/month</strong>, so there
          was never a cost reason to migrate it.
        </p>
      </>
    ),
  },
  {
    slug: "zero-trust-lab",
    railLabel: "Zero-trust-lab: phantom token pattern",
    title: "zero-trust-lab: the phantom token pattern, for real",
    date: "2026-07-19",
    tags: ["cognito", "kms", "jwt", "aws"],
    body: (
      <>
        <p>
          A learning exercise built as a real deployable stack, not a diagram: an edge gateway accepts an
          opaque token, exchanges it via an internal STS for a short-lived, audience-scoped JWT (RS256, signed
          by <strong>KMS</strong> - the private key never leaves KMS), and a separate domain gateway
          independently verifies that JWT with HTTP API's native JWT authorizer before reaching a backend.
          Real Cognito Hosted UI login, own DynamoDB table, own everything - fully isolated from the real
          site.
        </p>
        <ZeroTrustDiagram />
        <p>
          Gotchas hit building it, not hypothetical: a Lambda can't reference its own Function URL from its
          own environment variables (CloudFormation circular dependency) - fixed by deriving issuer/callback
          URLs from the request's <code>domainName</code> at runtime instead. HTTP API's native JWT authorizer
          needs full OIDC discovery, not a bare JWKS URL. Lambda Function URLs base64-encode the body under
          some conditions, so <code>JSON.parse(event.body)</code> without checking{" "}
          <code>isBase64Encoded</code> breaks silently. And <code>scheduler:UpdateSchedule</code> also needs{" "}
          <code>iam:PassRole</code> on the schedule target's execution role, not just permission on the
          schedule itself.
        </p>
        <p>
          Measured end to end against the live deployment: cold <strong>~3.6-3.7s</strong> (cold starts
          compound hop to hop), warm <strong>~950ms-1s</strong> - higher than a typical same-region
          Lambda-to-Lambda call because nothing here is connection-pooled or VPC-colocated. Every hop is a
          real public HTTPS call, which is the direct cost of the security boundary, not overhead to trim.
        </p>
      </>
    ),
  },
  {
    slug: "price-tracker-web-search",
    railLabel: "Price tracking with Claude web search",
    title: "Price tracking with Claude web search - and why it's Coles-only",
    date: "2026-07-12",
    tags: ["claude", "web-search", "web-fetch", "pantry"],
    body: (
      <>
        <p>
          Pantry's "track price" toggle looks up current prices with <strong>claude-haiku-4-5</strong>'s{" "}
          <code>web_search</code> and <code>web_fetch</code> tools, batched into one call per sync run rather
          than one call per item - search finds the product page, fetch confirms the price actually on it.
        </p>
        <div className="note-table-wrap">
          <table className="note-table">
            <thead>
              <tr>
                <th>Store</th>
                <th>Price via search + fetch</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Coles</td>
                <td>Reliable</td>
                <td>Product pages fetch cleanly, price confirmable on the page</td>
              </tr>
              <tr>
                <td>Woolworths</td>
                <td>Not reliable - dropped</td>
                <td>
                  Akamai fronts woolworths.com.au - blocks or challenges the fetch, confirmed live, repeatedly
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Haiku with the basic tool variants came out ~4-5x cheaper than Sonnet 5 with the newer
          dynamic-filtering variants, for equivalent results. Worth checking directly rather than assuming:
          one uncapped Sonnet test run spiralled into a single <strong>9.5-minute, $2.56</strong> call. Tool
          budget, a wall-clock timeout, and a max-items-per-run cap are load-bearing now, not nice-to-haves.
        </p>
      </>
    ),
  },
];

export default function Notes() {
  const [activeSlug, setActiveSlug] = useState(ENTRIES[0].slug);
  const activeEntry = ENTRIES.find((entry) => entry.slug === activeSlug) ?? ENTRIES[0];

  function select(slug: string) {
    setActiveSlug(slug);
    document.getElementById("note-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <>
      <header className="page-head">
        <p className="eyebrow">experiments &amp; learnings</p>
        <h1>Notes</h1>
        <p className="tagline">
          Short write-ups from building the rest of this site - what a pattern actually cost, what broke, what
          the numbers turned out to be once measured instead of assumed.
        </p>
      </header>

      <div className="notes-layout">
        <nav className="notes-rail" aria-label="Notes">
          {ENTRIES.map((entry) => (
            <button
              key={entry.slug}
              type="button"
              className={`notes-rail-item ${activeSlug === entry.slug ? "active" : ""}`}
              onClick={() => select(entry.slug)}
            >
              <span className="notes-rail-label">{entry.railLabel}</span>
              <span className="notes-rail-date">{entry.date}</span>
            </button>
          ))}
        </nav>

        {/* Tab panel - only the selected entry renders here, the rest aren't
            in the DOM at all (not just visually collapsed), so switching
            tabs fully replaces the content instead of accordion-expanding
            one card among several. */}
        <article className="note-entry" id="note-panel" key={activeEntry.slug}>
          <div className="note-entry-head">
            <span className="note-title">{activeEntry.title}</span>
            <span className="note-date">{activeEntry.date}</span>
          </div>
          <div className="note-tags">
            {activeEntry.tags.map((tag) => (
              <span className="note-tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
          <div className="note-body">{activeEntry.body}</div>
        </article>
      </div>

      <Footer />
    </>
  );
}
