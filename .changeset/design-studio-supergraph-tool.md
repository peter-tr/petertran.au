---
"design-studio": minor
---

Add an opt-in `AiSettings.allowSupergraphQuery` toggle that lets `generateDesignElements` call a read-only tool (`query_portfolio_data`) to look up real portfolio content (person, education, experience, projects, skills, programs, interests) from the public composed supergraph endpoint, grounding generated designs in real facts (e.g. a resume header using the actual current job title). The tool call is a short, bounded (2-iteration) `tool_use` loop that runs before the existing structured-output generation call, validated by a new hand-rolled portfolio-only field allowlist (`lib/util/portfolio-query-allowlist.ts`) that rejects mutations, subscriptions, the `meta` field, and the Federation `_service` introspection field before anything leaves this Lambda. Off by default; any failure gathering context degrades to unaugmented generation rather than breaking the request.
