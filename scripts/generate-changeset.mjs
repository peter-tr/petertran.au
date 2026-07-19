#!/usr/bin/env node
// Auto-generates a changeset from this PR's title + touched packages when
// none exists yet, so the common case needs no manual `npm run changeset`
// step. check-changeset-coverage.mjs remains the enforced safety net for
// when this can't determine what to do (e.g. an unparseable title) - it
// still fails and asks for a manual changeset in that case.
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { packageForPath } from "./lib/tracked-packages.mjs";

// Mirrors check-changeset-coverage.mjs's bypass - the Changesets bot's own
// "Version Packages" PR consumes changesets rather than needing one generated.
if (process.env.GITHUB_HEAD_REF?.startsWith("changeset-release/")) {
  console.log("Changesets release PR - skipping auto-generation.");
  process.exit(0);
}

const prTitle = process.env.PR_TITLE;

if (!prTitle) {
  console.log("No PR_TITLE provided - skipping auto-generation.");
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
  console.log("No tracked packages touched - nothing to generate.");
  process.exit(0);
}

const hasChangeset = changedFiles.some(
  (f) => f.startsWith(".changeset/") && f.endsWith(".md") && f !== ".changeset/README.md"
);

if (hasChangeset) {
  console.log("A changeset already covers this PR - not auto-generating.");
  process.exit(0);
}

const titleMatch = prTitle.match(/^(\w+)(\(([^)]+)\))?(!)?:\s*(.+)$/);

if (!titleMatch) {
  console.log(`PR title "${prTitle}" isn't Conventional Commits format - can't infer a bump.`);
  process.exit(0);
}

const [, type, , , breaking, subject] = titleMatch;
const bump = breaking ? "major" : type === "feat" ? "minor" : "patch";

const frontmatter = [...touchedPackages].map((pkg) => `"${pkg}": ${bump}`).join("\n");
const fileName = `.changeset/auto-${randomBytes(4).toString("hex")}.md`;

writeFileSync(fileName, `---\n${frontmatter}\n---\n\n${subject}\n`);

console.log(`Generated ${fileName} covering [${[...touchedPackages].join(", ")}] as ${bump}.`);
