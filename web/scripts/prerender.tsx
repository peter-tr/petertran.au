// Build-time prerendering: this app is a pure client-rendered SPA (see
// main.tsx's plain createRoot().render(), no hydrateRoot), so the raw HTML
// any non-JS fetcher gets back - crawlers, AI tools browsing the web,
// curl - is just an empty <div id="root"></div>. Real content only exists
// after the JS bundle runs and fetches data from the GraphQL API.
//
// This runs after `vite build`, fetches the same resume data the live site
// does, and renders the real presentational section components (they're
// pure enough for react-dom/server - the only browser-only bits, Hero's
// matchMedia call and Section's IntersectionObserver, only execute inside
// useEffect, which SSR never runs) into the built dist/index.html and a new
// dist/resume file. A real browser's JS still takes over and re-renders
// normally on top - this only changes what a non-JS fetch sees, not the
// interactive experience. It also snapshots the pristine, pre-edit shell to
// dist/fallback.html, which CloudFront serves for every other client-routed
// path (see site-stack.ts's errorResponses) - it must stay generic, not
// "/"'s rendered content.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import Nav from "../src/portfolio/components/Nav";
import ExperienceSection from "../src/portfolio/components/ExperienceSection";
import EducationSection from "../src/portfolio/components/EducationSection";
import ProjectsSection from "../src/portfolio/components/ProjectsSection";
import SkillsSection from "../src/portfolio/components/SkillsSection";
import InterestsSection from "../src/portfolio/components/InterestsSection";
import { createGraphQLClient } from "../src/shared/graphqlClient";
import type { ResumeData } from "../src/portfolio/lib/types";

// react-router's <Link>/<MemoryRouter> use useLayoutEffect internally for
// scroll restoration, which is harmless here (this output is never
// hydrated) but otherwise spams a known, expected warning on every element
// rendered - drop just that one message so real errors aren't buried in it.
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("useLayoutEffect does nothing on the server")) return;
  originalConsoleError(...args);
};

const DIST_DIR = path.resolve(import.meta.dirname, "../dist");

const RESUME_QUERY = /* GraphQL */ `
  query Resume {
    person {
      name
      email
      location
      clearance
      links {
        label
        url
      }
    }
    education {
      institution
      degree
      location
      startDate
      endDate
      honors
    }
    experience {
      company
      role
      location
      startDate
      endDate
      isCurrent
      summary
      highlights
    }
    projects {
      name
      stack
      description
      url
    }
    skills {
      category
      items
    }
    programs {
      name
      organization
      description
      startDate
      endDate
    }
    interests {
      hobbies
      favoriteFoods
      favoriteShows
    }
  }
`;

// This runs as a plain Node script after `vite build`, in its own process -
// it has no access to the `--mode` flag that build passed to vite, so
// `build:test` (see package.json) sets PRERENDER_ENV_FILE=.env.test
// explicitly. Without it, this silently fell back to reading
// .env.production even during a test-env build, so a test deploy always
// prerendered against whatever was live in *prod* - harmless by luck while
// prod and test happened to expose the same route shape, but broke outright
// the moment prod and test diverged (prod not yet having a route this
// build's .env.production pointed at).
function readEnvVar(name: string): string {
  const envFileName = process.env.PRERENDER_ENV_FILE ?? ".env.production";
  const envFile = readFileSync(path.resolve(import.meta.dirname, `../${envFileName}`), "utf-8");
  const match = envFile.match(new RegExp(`^${name}=(.+)$`, "m"));
  if (!match) throw new Error(`${name} not found in web/${envFileName}`);

  return match[1].trim();
}

// A plain equivalent of Footer.tsx's static markup, skipping its live-cost
// useEffect fetch (which never runs during SSR anyway, and importing the
// real component would drag in ../lib/graphql.ts's import.meta.env usage -
// a Vite-only global this plain Node script doesn't have).
function StaticFooter({ email }: { email: string }) {
  return (
    <footer className="footer">
      <span>
        © 2026 Peter Tran · <a href={`mailto:${email}`}>{email}</a>
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

function injectIntoShell(shellHtml: string, bodyHtml: string, title?: string, description?: string): string {
  let html = shellHtml.replace('<div id="root"></div>', `<div id="root">${bodyHtml}</div>`);
  if (title) html = html.replace(/<title>.*<\/title>/, `<title>${title}</title>`);
  if (description) {
    html = html.replace(/(<meta\s+name="description"\s+content=")[^"]*(")/s, `$1${description}$2`);
  }

  return html;
}

async function main() {
  const endpoint = readEnvVar("VITE_GRAPHQL_ENDPOINT");
  const runQuery = createGraphQLClient(endpoint, "VITE_GRAPHQL_ENDPOINT");
  const data = await runQuery<ResumeData>(RESUME_QUERY);

  const shellPath = path.join(DIST_DIR, "index.html");
  const shellHtml = readFileSync(shellPath, "utf-8");

  // CloudFront's 403/404 error responses (site-stack.ts) serve a single
  // static file for every route this script doesn't know about - /notes,
  // /pantry, /imposter, /settings, anything. That file must stay the
  // pristine, generic shell (empty #root, generic title/meta) - captured
  // here, before shellHtml gets overwritten below with content specific to
  // "/". Pointing the fallback at the post-prerender index.html instead
  // (as this used to) meant every one of those other routes rendered the
  // home page's bio/title first, until client JS mounted over it.
  const fallbackPath = path.join(DIST_DIR, "fallback.html");
  writeFileSync(fallbackPath, shellHtml);
  console.log(`Wrote generic fallback shell -> ${fallbackPath}`);

  const currentRole = data.experience.find((e) => e.isCurrent) ?? data.experience[0];

  // --- Home ("/") -----------------------------------------------------
  // Hero itself isn't SSR-safe (calls window.matchMedia during render), and
  // its typing-animation/live-query framing only makes sense for a real
  // browser anyway - this is a plain static equivalent of the same bio, not
  // an attempt to replicate the interactive version.
  const homeBody = renderToStaticMarkup(
    <MemoryRouter initialEntries={["/"]}>
      <Nav />
      <main className="wrap" id="top">
        <header className="hero">
          <p className="eyebrow">backend software engineer · sydney, australia</p>
          <h1>{data.person.name}</h1>
          <p className="tagline">
            I grew up in Brisbane, studied software engineering at the University of Queensland, and now work
            on GraphQL federation at Commonwealth Bank in Sydney — before that, Boeing and Services Australia.
            I enjoy helping the people around me, and I&apos;m always keen to learn something new.
          </p>
          {currentRole && (
            <p className="project-desc">
              Currently {currentRole.role} at {currentRole.company}. Full work history at{" "}
              <a href="/resume">/resume</a>, or query this page&apos;s live GraphQL API directly.
            </p>
          )}
        </header>
        <StaticFooter email={data.person.email} />
      </main>
    </MemoryRouter>
  );
  writeFileSync(shellPath, injectIntoShell(shellHtml, homeBody));
  console.log(`Prerendered / (${homeBody.length} chars) -> ${shellPath}`);

  // --- Resume ("/resume") ----------------------------------------------
  const resumeBody = renderToStaticMarkup(
    <MemoryRouter initialEntries={["/resume"]}>
      <Nav />
      <main className="wrap" id="top">
        <header className="page-head">
          <p className="eyebrow">full work history &amp; skills · {data.person.clearance}</p>
          <h1>Resume</h1>
          <div className="hero-links">
            <a href="/peter-tran-resume.pdf" target="_blank" rel="noreferrer">
              Download PDF
            </a>
          </div>
        </header>
        <ExperienceSection experience={data.experience} />
        <EducationSection education={data.education} programs={data.programs} />
        <ProjectsSection projects={data.projects} />
        <SkillsSection skills={data.skills} />
        <InterestsSection interests={data.interests} />
        <StaticFooter email={data.person.email} />
      </main>
    </MemoryRouter>
  );
  const resumePath = path.join(DIST_DIR, "resume");
  writeFileSync(
    resumePath,
    injectIntoShell(
      shellHtml,
      resumeBody,
      `${data.person.name} — Resume`,
      `${data.person.name}'s full work history, education, projects, and skills. Backend software engineer — GraphQL federation, distributed systems, safety-critical software.`
    )
  );
  console.log(`Prerendered /resume (${resumeBody.length} chars) -> ${resumePath}`);
}

main().catch((err) => {
  console.error("Prerender failed:", err);
  process.exit(1);
});
