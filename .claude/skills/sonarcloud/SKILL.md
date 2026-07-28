---
name: sonarcloud
description: Query SonarCloud (peter-tr_petertran.au) for quality gate status, bugs, vulnerabilities, and code smells via the Web API. Use when asked about Sonar/SonarCloud/SonarQube issues, code quality, or static analysis results for this repo.
---

# SonarCloud

This repo is analyzed on SonarCloud in **Automatic Analysis** mode - there is no
`sonar-project.properties`, no CI workflow step, and no `sonar-scanner` dependency in
this repo. SonarCloud's GitHub App scans directly on push to `main` and on PRs.
Consequence: **coverage will read empty/0** since that metric needs a CI step that
uploads a coverage report (e.g. vitest's `lcov.info`) - everything else (bugs,
vulnerabilities, code smells, duplication) works from source alone.

- Org: `peter-tr`
- Project key: `peter-tr_petertran.au`
- Dashboard: https://sonarcloud.io/summary/overall?id=peter-tr_petertran.au&branch=main

## Where the token lives

The user's personal SonarCloud access token (My Account -> Security -> Generate
Token) is exported as `SONARQUBE_KEY` in `~/.zshrc`. It is **not** a GitHub Actions
secret and does nothing for CI - it only works for local/API calls made from a shell.

Gotcha: a Bash tool session started before the var was added to `~/.zshrc` won't have
it. Always `source ~/.zshrc` first and confirm non-empty before using it:

```bash
source ~/.zshrc 2>/dev/null
[ -n "$SONARQUBE_KEY" ] || echo "SONARQUBE_KEY not set"
```

Never echo/print the token value itself in output.

## Calling the API

SonarCloud uses HTTP Basic auth with the token as the username and an empty password:

```bash
curl -s -u "$SONARQUBE_KEY:" "https://sonarcloud.io/api/<endpoint>"
```

Useful endpoints:

```bash
# Quality gate status (new-code conditions)
curl -s -u "$SONARQUBE_KEY:" "https://sonarcloud.io/api/qualitygates/project_status?projectKey=peter-tr_petertran.au&branch=main"

# Headline measures
curl -s -u "$SONARQUBE_KEY:" "https://sonarcloud.io/api/measures/component?component=peter-tr_petertran.au&branch=main&metricKeys=bugs,vulnerabilities,code_smells,security_hotspots,coverage,duplicated_lines_density,ncloc"

# Open issues, with facet breakdowns (severities/types/directories/rules)
curl -s -u "$SONARQUBE_KEY:" "https://sonarcloud.io/api/issues/search?componentKeys=peter-tr_petertran.au&branch=main&resolved=false&ps=100&facets=severities,types,directories,rules"

# Human-readable rule name/description - organization param is required or this 400s
curl -s -u "$SONARQUBE_KEY:" "https://sonarcloud.io/api/rules/show?key=typescript:S6438&organization=peter-tr"
```

Filter `issues/search` further with `types=BUG|VULNERABILITY|CODE_SMELL`,
`severities=BLOCKER|CRITICAL|MAJOR|MINOR`, or `componentKeys=` scoped to a
subpath, to drill into a specific bucket before reporting it to the user.
