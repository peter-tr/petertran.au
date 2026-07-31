# web

## 1.7.0

### Minor Changes

- 56caa75: Design Studio: delete a custom template (seed templates stay protected), the "Generate with AI" panel now replaces the Layers/Properties column instead of rendering below the fold, a fixed category list replaces free-text "Save as template" categories, saved designs show a header and a relative "edited Nm/h/d ago" time, the gallery's quick-create buttons get their own row, the settings/gallery cog and info/help buttons match pantry's pattern, and the settings page gets an architecture diagram with the MongoDB rationale.

  Site-wide: imposter's page header now matches pantry/design-studio's compact style with the same "i" info button; the standalone nav's "studio" link is renamed "design-studio" and "notes" moved into the footer as "experiments"; the home page's "also built" note and its settings toggle now mention design-studio too; and settings checkboxes with long descriptions now keep the checkbox and wrapped text aligned in a column instead of wrapping flush against the page edge.

- 8c1bc30: pantry now refetches inventory/shopping-list/settings immediately on sign in/out instead of requiring a page refresh; portfolio settings' cold-start lookback window is remembered per-browser instead of resetting to 24h; the warm-schedule editor renames "this resume site" to "portfolio", bolds each project's name, clarifies that the schedule and reactive-warm toggles are independent, and shows a last-24h cost estimate per project and as a page total

### Patch Changes

- f62588e: move AI panel back inline, fix portrait canvas alignment
- 30cdbb6: rebalance portfolio architecture diagram, add sibling project links
- 65b090d: resume-data bug, AI-panel dedup, canvas zoom, adaptive toolbar
- 99b2b5d: fix a broken test suite and a state-sharing bug from the cold-start auto-run change

  The previous PR's automatic cold-start-check effect shared one `error` state with the initial config-load effect - since both fire independently on mount, whichever settled last could silently overwrite the other's message. Split into a separate `coldStartError`, shown alongside the existing warm-schedule error on the settings page. Also fixes `useWarmSchedule.test.ts`, which mocked `fetch` call sequences that assumed only one fetch happens on mount - the new automatic cold-start check adds a second, independent one, which was shifting every subsequent mocked response by one and crashing `saveProfile`/`applyProfile`/`deleteProfile`/`saveAll` in tests (this should have been caught by `npm run test` before the prior PR merged, not after).

- dbf5cb1: auto-run the warm-schedule settings page's cold start check, and make its lookback window configurable

  The check across all 6 projects completes in a few seconds, so it now runs automatically (on page load and whenever the lookback window changes) instead of needing an explicit button click. The lookback window is now a picker (10 min / 1 hour / 24 hours) instead of a fixed 24h, via a new `windowMinutes` parameter on `warm-schedule`'s `checkColdStarts` action (validated against the same curated set on both sides, same "seeded in two places" convention as `MAX_CONCURRENCY`/`MEMORY_OPTIONS_MB`). No infra changes - this reuses the IAM grants and timeout bump already shipped in the initial cold-start-check PR.

- b52171e: extract the shared architecture-diagram "chrome" (arrow marker, Browser/CDK/GitHub Actions node blocks, provisioning connectors) that PantryArchitectureDiagram and DesignStudioArchitectureDiagram had each been duplicating into a shared component; also refreshes local (darwin) visual-e2e baseline snapshots for the Hero and Imposter header changes shipped in #238.
- 54c26a4: Design Studio: fixes the "i"/"h" info/help panel text hugging the left edge of the page instead of aligning under the header; replaces the "New Poster"/"New Presentation"/"New Resume" quick-create buttons (two of which were both landscape and only ~60px apart in height) with orientation-based "New Landscape"/"New Vertical"/"New Custom…" (custom prompts for width/height, since the canvas can't be resized after creation); adds a "← Design Studio" breadcrumb to the editor page; and raises the desktop-only default zoom fit ceiling so a typical design isn't rendered smaller than the available space allows (mobile's fit is unchanged).
- 6066999: fix design-studio Gallery footer spanning the full viewport width instead of staying in the centered content column
- 7387aa6: move Footer into shared/ and render it on every page, fixing a cross-project boundary crossing flagged by SonarCloud's Architecture graph
- 38fa42e: Restore explicit assertions dropped by an earlier find*-query conversion (SonarCloud S2699, BLOCKER), and fix 3 smaller regressions surfaced by a fresh SonarCloud scan: Number.NaN over NaN, a useState pair that collided names with a wrapping setter, and a stable per-row key for the imposter player list instead of array index
- 4cab523: Replace waitFor+getBy/queryBy with find* queries in several test files (SonarCloud S9020), and collapse 8 near-identical portfolio-query-allowlist rejection tests into a single parameterized it.each block (S9020/S5976 cleanup, test-only changes)
- cc961ea: portfolio: keep the hero's "also built ..." line to one row on mobile and prevent "design-studio" from splitting mid-word when it does wrap
- ac70e79: Simplifies pantry's sign-in/sign-up form - no more native browser email-format/required/minLength validation popups (Cognito's own SignUp/InitiateAuth error response already surfaces a real message for a bad email or short password, so the browser's native validation was just a redundant, worse-worded copy of that), and adds a short blurb explaining why you'd bother creating an account. Also shrinks Imposter's permanently-visible tagline from the site's larger marketing-page text size down to the same muted body-copy size pantry and design-studio already use, so all three standalone pages read consistently, especially on mobile.
- cc961ea: pantry: turn inventory/shopping list group-by and sort-by controls into dropdowns, make clicking an inventory item's name open the edit modal (matching the shopping list), and use an X icon for the inventory delete button
- cc961ea: pantry: add an Inventory show/hide toggle to match the shopping list, rename the "priority" grouping's "Needs attention" label to "Regular", and add a "Low stock first" sort option
- 8cdf548: fix pantry sign-in inputs zooming in on mobile Safari when focused
- 05400b3: keep pantry inventory simple-mode rows to one line on mobile (ellipsis-truncate long names, compact ✕ delete button)
- 7d91212: fix SonarCloud accessibility, complexity, and React key issues across the pantry UI
- edea494: add reactive Provisioned Concurrency: 1hr warm after a real cold start, opt-in per project from the portfolio settings page, alongside a live "reactively warm until" status readout
- ecb0caa: refresh visual-e2e linux baseline snapshots to match current font rendering
- c42c68e: remove the "warm pantry/imposter on page load" and "delay footer/stats queries" per-browser settings toggles - neither reliably helped in practice. Also drops the "built with AWS CDK · Lambda · DynamoDB · CloudFront" line from the footer.
- caf7a9e: Remove the clearance line from the resume page header and tighten vertical whitespace between and within the resume's collapsible sections (Experience, Education, Projects, Skills, Interests).
- d971f21: Resolve the SonarCloud findings across the web workspace (outside pantry): swap pseudo-interactive `<div>`/`<h1>`/`<li>` click targets for real buttons and ARIA `role="group"`/`role="img"` for `<fieldset>`/SVG `<title>`, mark every component's props `Readonly<...>`, extract nested ternaries and a nested template literal, give mapped lists stable keys, make `useState` pairs symmetric, and simplify `GraphQLCode`'s token regex plus the cognitive complexity of `formatQuery` and the imposter setup form. No user-facing behaviour change.
- 0809087: warm-schedule editor: move the schedule toggle directly above the day/time editor it controls (with the reactive-warm toggle first), state the two toggles' independence once in the shared intro instead of on every row, hide the day/time editor entirely when a project's schedule is off, drop the "(GraphQL gateway in front of the three above)" aside from the supergraph label, and let each project row collapse/expand

## 1.6.0

### Minor Changes

- 10cae99: identify GraphOS clients via apollographql-client-name
- 9e77a5c: last-1-day/7-day/all-time stat toggles
- 992ade4: Add a dedicated `/design-studio/settings` page, linked from the gallery header, showing the AI provider/model tier controls (previously only editable inline in the editor's AI panel) alongside a new "Portfolio data access" toggle for the new `allowSupergraphQuery` setting.
- 17d834f: add a Settings toggle for the footer's real cost line

  Lets a visitor hide the "real cost since launch" line in the footer - a per-browser localStorage preference, following the same pattern as the other Settings toggles (`useShowAlsoBuilt`, `usePageLoadWarmup`). When off, the `Footer` GraphQL query is skipped entirely rather than fetched and just hidden. Also notes that the AWS side of the displayed cost is within the $200 AWS Free Tier credit.

- 7ff6b62: add a pantry settings toggle for the AI command bar's provider (direct Anthropic API or AWS Bedrock) and model tier (Haiku/Sonnet), matching design-studio's existing AiSettings pattern. Extracted the provider/model-ID resolution and Bedrock IAM policy into shared modules (`api-shared/ai-provider`, `infra/lib/shared/bedrock-models.ts`) so design-studio and pantry share one implementation instead of two copies. Price checking (Coles lookups) always stays on the direct Anthropic API, since Bedrock doesn't support the web_search/web_fetch tools it depends on.
- 240ddbd: add a stale-while-revalidate cache for the pantry page: it now paints instantly from the last-loaded inventory/shopping list/settings on mount while a fresh copy loads in the background, instead of waiting on the network every visit. Controlled by a new "Instant load" toggle on the pantry settings page (`instantLoadCache` on `PantrySettings`, default on) - the cache is scoped per signed-in account (or the shared/default pantry when signed out) and clears immediately when the toggle is switched off.
- b0487a5: add saveable/applyable "profiles" to the warm-schedule settings page

  Snapshots the whole 6-project provisioned-concurrency config (all
  schedules/concurrency/memory at once) under a name, stored in a new SSM
  parameter alongside the live config. The settings page can now save the
  current setup as a profile, apply a saved one back (flipping every
  project's real EventBridge schedules and reconciling PC/memory
  immediately, same as an individual project save), or delete one - so
  switching between modes (e.g. "all cold, 1024MB" vs "PC everywhere,
  512MB") no longer means hand-editing every row.

### Patch Changes

- 5971ccb: give the pantry sign-in popover a real background
- 25e3615: apply mechanical SonarCloud fixes across api/web/infra
- 738c292: update RequestsChart tests for the 3-way time-range toggle
- a276c0a: sort category/tag lists with localeCompare, drop dead flex-basis
- b00797a: save all dirty warm-schedule projects in one atomic request
- 5611736: stop pantry sign-in button overflowing on mobile
- 6540fbe: static router.yaml + per-app GraphOS client names
- f43e405: tighten command bar assistant status-line spacing
- 13e97fb: design-studio: title-based PNG export filename, AI panel polish, bottom toolbar

  Export PNG now downloads using the design's own title instead of a hardcoded `design.png`. The AI panel's Accept/Discard buttons move below the prompt input with intent-colored borders, and the provider/model pickers collapse behind a cog icon instead of always showing. The toolbar moves from a vertical rail beside the canvas to a horizontal bar underneath it, freeing that width for the canvas; the layers list gets a bounded, scrollable height so a long layer list can't push the canvas down the page.

- bb5ce9b: add an on-demand "Check cold start rate" action to the warm-schedule settings page

  Runs a CloudWatch Logs Insights query (`filter @type = "REPORT" | stats count(@initDuration) as coldStarts, count(*) as total`) per project over the last 24h, aggregated across all of that project's target Lambdas, and surfaces the cold-start count/percentage next to each project's existing cost line - previously there was no way to tell from the settings page whether a given PC schedule was actually working. Kept as an explicit "check now" button rather than a live/cached figure, since Logs Insights queries are async and take several seconds each; the existing scheduled+cached pattern used for cost data would be overkill for a rarely-clicked diagnostic. `warm-schedule`'s Lambda gets new `logs:StartQuery`/`logs:GetQueryResults` IAM grants scoped to each target's own log group, and its timeout is bumped 60s -> 120s to give the new action real margin.

## 1.5.0

### Minor Changes

- 2fd594a: extend scheduled Provisioned Concurrency to design-studio
- d3ef17c: stagger Home's fetches so Hero always wins a warm slot
- 5bf2b32: link CloudWatch RUM sessions to their X-Ray traces
- fce1369: design-studio AI generation: switch default model from Haiku 4.5 to Sonnet 4.6, add a provider/model picker (direct Anthropic API or AWS Bedrock), and improve the generation prompt with a worked example and margin/alignment/contrast rules
- 46d2050: add Design Studio, a mock-Canva editor (MongoDB Atlas-backed)
- 2356941: add AI-assisted design generation to Design Studio - a "Generate with AI" prompt that produces a set of design elements from a natural-language description (via a new `generateDesignElements` mutation, Anthropic structured output, and a Mongo-backed rate limiter since Design Studio has no DynamoDB table). The result renders as a dashed-outline draft overlay, draggable/resizable independently of the real canvas and outside undo/redo history, until the user explicitly Accepts (adding it to the design) or Discards it.
- c6b76e9: design-studio: center the canvas properly between the toolbar and side panels (was shifted off-center since they're different widths), shrink the oversized "Generate with AI" heading, add style-preset chips (None/Fancy/Classic/Vintage/Funny) to the AI panel, and tone down the AI draft's glowing outline to something subtler
- 0282fe0: support multiple canvas formats in Design Studio (Poster, Presentation, Resume) instead of one fixed 900x600 size, add a Resume template, and resize the Presentation template to a true 16:9 slideshow canvas
- da389a4: improve Design Studio's editor for mobile and add an Arrow tool. The canvas now scales to fit narrow/short viewports (via a CSS transform Konva already accounts for when mapping pointer coordinates, rather than the old fixed-size-plus-horizontal-scroll layout), capped by both available width and a fraction of viewport height so a short landscape phone screen doesn't get buried under an oversized canvas. The "Generate with AI" panel moved out of the cramped 14rem side rail into a full-width section with a multi-row prompt textarea instead of a one-line input. Double-clicking a text element to edit it no longer shows a near-opaque white box that made light/white-fill text invisible while editing - the overlay is transparent so the real canvas shows through. The toolbar also gained Excalidraw-style numbered shortcuts (1-5) and a new Arrow tool alongside Rectangle/Ellipse/Text.
- 00c05fd: add a "Save as template" action to Design Studio's editor, letting the current canvas be saved into the shared templates library (colors auto-derived from the design's own fills, new templates default to popularity 0)
- 6168fb9: personalize Design Studio's starter templates and stop "Use template" from persisting a design until the user explicitly saves it
- 0d1e57a: add multi-user support to pantry: sign in via a new Cognito Hosted UI pool to get a private inventory/shopping list/settings, scoped by `pk`. Anyone not signed in keeps using the existing shared/default pantry unchanged.
- 028291a: show a real, live-computed price per project on the warm-schedule settings section - each project's real Lambda memory size and currently-allocated provisioned concurrency, queried live via GetFunctionConfiguration/GetProvisionedConcurrencyConfig, instead of one static "~$1.58/mo" estimate for all of them

### Patch Changes

- d7caf9b: add notes entry on the Lambda cold-start/ADOT-ESM investigation
- 5327745: derive RUM's X-Ray origin from config, deflake jwt.test.ts
- aad71f3: wire in the real pantry Cognito domain/client id
- f4ab997: fix design-studio Gallery's "No designs yet" empty state sitting flush against the page edge instead of aligning with the centered content column
- 30e3720: stop trace polling from declaring victory on platform-only segments
- f90adee: make PNG export non-blocking
- e4ea438: design-studio: fix the AI provider/model dropdowns overflowing off-screen, make Generate with AI aware of elements already on the canvas (not just its own prior draft), dim the real canvas while a draft preview is showing, and swap the draft outline from red to the app's teal accent
- 20f295d: let memory size become a live settings-page control alongside Provisioned Concurrency scheduling

  Adds `memoryMb` to the warm-schedule config (settings page, `/warm-schedule`
  endpoint, and CDK's `WarmSchedule` type), reconciled the same way concurrency
  already is - `handler.ts`'s new `reconcileMemory()` runs
  `UpdateFunctionConfiguration` -> `PublishVersion` -> `UpdateAlias` whenever a
  target's live memory differs from what's configured, verified live against a
  throwaway Lambda that Provisioned Concurrency granted on an alias qualifier
  automatically re-provisions against wherever the alias points after a move,
  so no separate stale-version cleanup is needed.

  Also switches portfolio/pantry/imposter/design-studio's main GraphQL Lambda
  from 1024MB to 512MB, doubling their Provisioned Concurrency counts - cost-
  neutral (PC is priced in GB-seconds, so 1x1024MB costs the same as
  2x512MB), and directly fixes PC's actual capacity shortfall (a single page
  load fires more than one concurrent GraphQL request, enough to exceed PC=1
  on its own) rather than the 1024MB bump's original premise (more memory
  directly cuts cold-start latency), which didn't hold up under isolated
  testing once the real ESM/ADOT cold-start cause was fixed separately.

- d2802bd: fix Design Studio's AI generation UX: the draft overlay's yellow outline was hard to see against similarly-colored designs (now a high-contrast pink outline with a glow, visible regardless of the underlying palette); the Accept/Discard buttons were in the wrong order (Discard now sits left/secondary, Accept right/primary, matching standard dialog conventions); and the one-shot prompt form has been replaced with a persistent chat-style panel that stays open across generations, so a follow-up like "make it bigger" refines the current draft instead of starting over.
- 1f9ff11: fix a real Design Studio data-loss bug: accepting a multi-element AI-generated draft (or any code path calling `useEventHistory`'s `dispatch` more than once within the same synchronous batch) silently dropped every dispatched element except the last one, because `events` and `cursor` were separate `useState` calls and each dispatch's closure captured a `cursor` value that was stale for every call after the first in the same batch. `events`/`cursor` are now one combined state atom, so each dispatch sees every prior dispatch already queued in the same batch. This is why accepting an AI draft and then saving appeared to do nothing - only one element (if any) had actually survived to be saved.
- 3f3c2fd: perf(design-studio): cut Gallery's initial load from 3 concurrent GraphQL requests to 1 - `Gallery.tsx`'s own `listDesigns()` and `TemplatesSection`'s unfiltered `listTemplates()` fired independently, plus a near-duplicate `listTemplates()` from the debounced search/filter effect re-firing on mount with an empty filter. That 3rd request could overflow design-studio-graphql's 2-instance provisioned concurrency and cold-start (~4.1s Init Duration), which is what made a real page load slow - confirmed via CloudWatch/X-Ray/CloudTrail against the live Lambda. Combined designs+templates into one `GALLERY_QUERY`, and `TemplatesSection` now reuses that data instead of re-requesting the same unfiltered list.
- ef08064: fix(portfolio,web): pretty-print the query sample and render the X-Ray trace breakdown as a real collapsible call tree

  The "Query" sample in the ops stats panel was rendering as one unbroken
  line - `GraphQLCode` now reformats it before syntax-highlighting.

  The "Trace" waterfall discarded X-Ray's real segment hierarchy when
  flattening subsegments into a list. `traceBreakdown` now returns each
  segment's `id`/`parentId` (remapped past the platform-Lambda dedup so a
  segment nested under the dropped duplicate doesn't become an orphaned
  root), and `TraceWaterfall` rebuilds the tree client-side, rendering it
  indented with a per-parent expand/collapse toggle instead of a flat list.

  Also fixes an unrelated bug found while testing this in dev: OperationRow's
  `unmounted` ref was only ever set `true` in its effect cleanup and never
  reset on mount, so React 18 StrictMode's dev-only mount/unmount/remount
  cycle permanently discarded every trace fetch after the first render.

- b9a786b: fix(pantry): replace Cognito Hosted UI sign-in with an in-app email/password form - Hosted UI's authorization-code flow never actually completed in production because Cognito's `/oauth2/token` endpoint doesn't return CORS headers for a browser `fetch`. Sign-in/sign-up now call Cognito's IdP API directly with USER_PASSWORD_AUTH, with no email verification step and no MFA (a new pre-sign-up Lambda trigger auto-confirms accounts), and the header now shows an explicit "Sign out" label once signed in.
- 74532c1: replace per-project warm-schedule Save buttons with a single "Save all" button and a total cost line

  Lifts each project's draft schedule out of `WarmScheduleProject` (now a
  controlled component) and into `PortfolioSettingsPage`, so one "Save all"
  button at the bottom of the section can POST every dirty project's
  schedule at once via `useWarmSchedule`'s new `saveAll`, instead of each
  row round-tripping its own save. Also adds a total estimated monthly
  cost line, summing every project's `scheduledMonthlyCostUsd`.

## 1.4.0

### Minor Changes

- f44c18f: add CloudWatch alarms/dashboard and an alert-email toggle
- cbb9100: add hidden /notes page for experiments and learnings

### Patch Changes

- 062b67b: stop notes mobile rail pills from stretching to 9.5rem tall
- b43199c: stop client-routed pages from flashing the home page's prerendered content
- 9c1bdbf: stop notes page from forcing mobile viewport to zoom out
- 93c0b32: supergraph cold-start + configurable PC concurrency
- 6ad5e54: Route local dev/e2e GraphQL calls through the supergraph gateway instead of each subgraph's own dev-server port.
- e744989: Update home page architecture diagram to match current infra: API Gateway + Apollo Federation Supergraph gateway in front of the portfolio Lambda, plus the second Anthropic secret and Cost Explorer.

## 1.3.0

### Minor Changes

- 1984776: add supergraph to scheduled provisioned concurrency
- 74ea629: Apollo Federation supergraph gateway, prod and test

### Patch Changes

- 649a852: bootstrap prod's supergraph rollout in two steps
- 76e148e: stop warm-schedule deploys from wiping live settings, fix save UX
- 518b10d: remove scheduled warmup ping, make PC scheduling per-project
- b451168: run web prerender after infra deploy, not before
- 4165ddd: rename pc-config to warm-schedule for clarity
- 0da41b5: cut prod frontend over to the supergraph endpoint; raise the supergraph
  handler test's timeout for a cold CI cache

## 1.2.0

### Minor Changes

- 553f6a6: scheduled Provisioned Concurrency for portfolio/pantry/imposter + zero-trust-lab
- 8856b38: add Playwright visual e2e tests for portfolio/pantry/imposter

### Patch Changes

- 342c866: add Vitest unit test suites across all workspaces

## 1.1.0

### Minor Changes

- 36fcc26: add shared API Gateway in front of portfolio/pantry/imposter/warmup
- ac54c28: add on-demand test environment for safe big-change testing

### Patch Changes

- 05aeac4: memoize activeOperations to satisfy exhaustive-deps

## 1.0.2

### Patch Changes

- f183a4d: commit local dev API endpoints as .env.development

## 1.0.1

### Patch Changes

- 588dd41: document and suppress the intentional missing-deps warning
