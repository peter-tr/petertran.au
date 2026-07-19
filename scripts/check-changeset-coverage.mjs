#!/usr/bin/env node
// Changesets never inspects a PR's diff - it only bumps whatever packages a
// changeset file's frontmatter names. This script closes that gap: it maps
// this PR's changed files to tracked packages and fails if any touched
// package has no changeset covering it, unless an empty changeset (no
// packages listed) is present as an explicit "no bump needed" declaration.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { packageForPath } from "./lib/tracked-packages.mjs";

function parseChangesetPackages(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return [];
  const packages = [];
  for (const line of match[1].split("\n")) {
    const pkgMatch = line.match(/^"?([^":\s]+)"?\s*:\s*(major|minor|patch)\s*$/);
    if (pkgMatch) packages.push(pkgMatch[1]);
  }
  return packages;
}

// The Changesets bot's own "Version Packages" PR (branch `changeset-release/<base>`,
// see changesets/action's src/run.ts) bumps package.json/CHANGELOG.md files by
// *consuming* (deleting) existing changesets rather than adding new ones - it
// would otherwise permanently fail this exact check on every run.
if (process.env.GITHUB_HEAD_REF?.startsWith("changeset-release/")) {
  console.log("Changesets release PR - skipping coverage check.");
  process.exit(0);
}

const baseRef = process.env.CHANGESET_CHECK_BASE_REF ?? "origin/main";

const changedFiles = execSync(`git diff --name-only --diff-filter=AM ${baseRef}...HEAD`, {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);

const touchedPackages = new Set();
for (const file of changedFiles) {
  if (file.startsWith(".changeset/")) continue;
  const pkg = packageForPath(file);
  if (pkg) touchedPackages.add(pkg);
}

if (touchedPackages.size === 0) {
  console.log("No tracked packages touched - nothing to check.");
  process.exit(0);
}

const changedChangesetFiles = changedFiles.filter(
  (f) => f.startsWith(".changeset/") && f.endsWith(".md") && f !== ".changeset/README.md"
);

let coveredPackages = new Set();
let hasEmptyChangeset = false;

for (const file of changedChangesetFiles) {
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const packages = parseChangesetPackages(content);
  if (packages.length === 0) {
    hasEmptyChangeset = true;
  } else {
    for (const pkg of packages) coveredPackages.add(pkg);
  }
}

if (hasEmptyChangeset) {
  console.log("Empty changeset present - this PR is declared to need no version bump.");
  process.exit(0);
}

const missing = [...touchedPackages].filter((pkg) => !coveredPackages.has(pkg));

if (missing.length > 0) {
  console.error(`Missing changesets for: ${missing.join(", ")}`);
  console.error(
    `This PR touches [${[...touchedPackages].join(", ")}] but changesets only cover [${[...coveredPackages].join(", ") || "none"}].`
  );
  console.error(
    `Run "npm run changeset" to add one covering ${missing.join(", ")}, or "npx changeset add --empty" if this PR intentionally needs no version bump.`
  );
  process.exit(1);
}

console.log(`All touched packages (${[...touchedPackages].join(", ")}) are covered by changesets.`);
