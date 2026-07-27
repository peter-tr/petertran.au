# design-studio

## 0.3.0

### Minor Changes

- 992ade4: Add an opt-in `AiSettings.allowSupergraphQuery` toggle that lets `generateDesignElements` call a read-only tool (`query_portfolio_data`) to look up real portfolio content (person, education, experience, projects, skills, programs, interests) from the public composed supergraph endpoint, grounding generated designs in real facts (e.g. a resume header using the actual current job title). The tool call is a short, bounded (2-iteration) `tool_use` loop that runs before the existing structured-output generation call, validated by a new hand-rolled portfolio-only field allowlist (`lib/util/portfolio-query-allowlist.ts`) that rejects mutations, subscriptions, the `meta` field, and the Federation `_service` introspection field before anything leaves this Lambda. Off by default; any failure gathering context degrades to unaugmented generation rather than breaking the request.
- 7ff6b62: add a pantry settings toggle for the AI command bar's provider (direct Anthropic API or AWS Bedrock) and model tier (Haiku/Sonnet), matching design-studio's existing AiSettings pattern. Extracted the provider/model-ID resolution and Bedrock IAM policy into shared modules (`api-shared/ai-provider`, `infra/lib/shared/bedrock-models.ts`) so design-studio and pantry share one implementation instead of two copies. Price checking (Coles lookups) always stays on the direct Anthropic API, since Bedrock doesn't support the web_search/web_fetch tools it depends on.

### Patch Changes

- cfe30d6: enable federated field-level tracing for GraphOS Insights
- 25e3615: apply mechanical SonarCloud fixes across api/web/infra
- Updated dependencies [25e3615]
- Updated dependencies [803209b]
- Updated dependencies [7ff6b62]
  - api-shared@1.3.0

## 0.2.0

### Minor Changes

- fce1369: design-studio AI generation: switch default model from Haiku 4.5 to Sonnet 4.6, add a provider/model picker (direct Anthropic API or AWS Bedrock), and improve the generation prompt with a worked example and margin/alignment/contrast rules
- 46d2050: add Design Studio, a mock-Canva editor (MongoDB Atlas-backed)
- 2356941: add AI-assisted design generation to Design Studio - a "Generate with AI" prompt that produces a set of design elements from a natural-language description (via a new `generateDesignElements` mutation, Anthropic structured output, and a Mongo-backed rate limiter since Design Studio has no DynamoDB table). The result renders as a dashed-outline draft overlay, draggable/resizable independently of the real canvas and outside undo/redo history, until the user explicitly Accepts (adding it to the design) or Discards it.
- 0282fe0: support multiple canvas formats in Design Studio (Poster, Presentation, Resume) instead of one fixed 900x600 size, add a Resume template, and resize the Presentation template to a true 16:9 slideshow canvas
- da389a4: improve Design Studio's editor for mobile and add an Arrow tool. The canvas now scales to fit narrow/short viewports (via a CSS transform Konva already accounts for when mapping pointer coordinates, rather than the old fixed-size-plus-horizontal-scroll layout), capped by both available width and a fraction of viewport height so a short landscape phone screen doesn't get buried under an oversized canvas. The "Generate with AI" panel moved out of the cramped 14rem side rail into a full-width section with a multi-row prompt textarea instead of a one-line input. Double-clicking a text element to edit it no longer shows a near-opaque white box that made light/white-fill text invisible while editing - the overlay is transparent so the real canvas shows through. The toolbar also gained Excalidraw-style numbered shortcuts (1-5) and a new Arrow tool alongside Rectangle/Ellipse/Text.
- 00c05fd: add a "Save as template" action to Design Studio's editor, letting the current canvas be saved into the shared templates library (colors auto-derived from the design's own fills, new templates default to popularity 0)
- 6168fb9: personalize Design Studio's starter templates and stop "Use template" from persisting a design until the user explicitly saves it
- 890b543: feat(infra,design-studio): add design-studio to the on-demand test environment

  `PetertranTestDesignStudioStack` now deploys alongside the other 4 test
  subgraphs, wired into the test API Gateway and reachable through the test
  supergraph's composed `/graphql` endpoint. Isolated from prod by MongoDB
  database name (`design-studio-test` vs `design-studio`) rather than a
  second manually-provisioned Atlas cluster - the Lambda's `MONGO_DB_NAME`
  env var now controls this, defaulting to prod's existing behavior.

  `deploy-test-env.yml`/`destroy-test-env.yml` also now include
  `PetertranTestMonitoringStack`, which was previously instantiated in
  `infra/bin/app.ts` but never wired into either workflow's stack list - it
  could never actually deploy, and would have been orphaned (undeletable via
  the normal destroy workflow) if anyone ever deployed it manually.

  Also fixes `scripts/lib/tracked-packages.mjs`, which was missing
  `api/src/design-studio/` and `api/src/supergraph/` entries and so mis-tagged
  changes to either as `"api"` - the same mistagging problem CLAUDE.md already
  documents as having happened repeatedly for these two packages.

### Patch Changes

- 6f0ae76: fix(design-studio): build Lambda bundle as CommonJS instead of ESM, bundle AWS SDK v3 instead of externalizing

  Same ESM->CJS cold-start fix as pantry/portfolio (see pantry's changeset
  for the measured numbers), plus dropping `external: ["@aws-sdk/*"]` to
  match pantry/portfolio/imposter. Build now also minifies (previously
  didn't) as part of adopting the shared `buildCjsLambdas()` helper.

- d2802bd: fix Design Studio's AI generation UX: the draft overlay's yellow outline was hard to see against similarly-colored designs (now a high-contrast pink outline with a glow, visible regardless of the underlying palette); the Accept/Discard buttons were in the wrong order (Discard now sits left/secondary, Accept right/primary, matching standard dialog conventions); and the one-shot prompt form has been replaced with a persistent chat-style panel that stays open across generations, so a follow-up like "make it bigger" refines the current draft instead of starting over.
- Updated dependencies [fce1369]
- Updated dependencies [5e57e8f]
- Updated dependencies [0d1e57a]
  - api-shared@1.2.0
