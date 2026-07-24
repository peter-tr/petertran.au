# web

## 1.5.0

### Minor Changes

- 2fd594a: extend scheduled Provisioned Concurrency to design-studio
- d3ef17c: stagger Home's fetches so Hero always wins a warm slot
- 5bf2b32: link CloudWatch RUM sessions to their X-Ray traces
- 46d2050: add Design Studio, a mock-Canva editor (MongoDB Atlas-backed)
- 2356941: add AI-assisted design generation to Design Studio - a "Generate with AI" prompt that produces a set of design elements from a natural-language description (via a new `generateDesignElements` mutation, Anthropic structured output, and a Mongo-backed rate limiter since Design Studio has no DynamoDB table). The result renders as a dashed-outline draft overlay, draggable/resizable independently of the real canvas and outside undo/redo history, until the user explicitly Accepts (adding it to the design) or Discards it.
- 0282fe0: support multiple canvas formats in Design Studio (Poster, Presentation, Resume) instead of one fixed 900x600 size, add a Resume template, and resize the Presentation template to a true 16:9 slideshow canvas
- 00c05fd: add a "Save as template" action to Design Studio's editor, letting the current canvas be saved into the shared templates library (colors auto-derived from the design's own fills, new templates default to popularity 0)
- 6168fb9: personalize Design Studio's starter templates and stop "Use template" from persisting a design until the user explicitly saves it
- 0d1e57a: add multi-user support to pantry: sign in via a new Cognito Hosted UI pool to get a private inventory/shopping list/settings, scoped by `pk`. Anyone not signed in keeps using the existing shared/default pantry unchanged.

### Patch Changes

- 5327745: derive RUM's X-Ray origin from config, deflake jwt.test.ts
- aad71f3: wire in the real pantry Cognito domain/client id
- 30e3720: stop trace polling from declaring victory on platform-only segments
- d2802bd: fix Design Studio's AI generation UX: the draft overlay's yellow outline was hard to see against similarly-colored designs (now a high-contrast pink outline with a glow, visible regardless of the underlying palette); the Accept/Discard buttons were in the wrong order (Discard now sits left/secondary, Accept right/primary, matching standard dialog conventions); and the one-shot prompt form has been replaced with a persistent chat-style panel that stays open across generations, so a follow-up like "make it bigger" refines the current draft instead of starting over.
- 1f9ff11: fix a real Design Studio data-loss bug: accepting a multi-element AI-generated draft (or any code path calling `useEventHistory`'s `dispatch` more than once within the same synchronous batch) silently dropped every dispatched element except the last one, because `events` and `cursor` were separate `useState` calls and each dispatch's closure captured a `cursor` value that was stale for every call after the first in the same batch. `events`/`cursor` are now one combined state atom, so each dispatch sees every prior dispatch already queued in the same batch. This is why accepting an AI draft and then saving appeared to do nothing - only one element (if any) had actually survived to be saved.
- b9a786b: fix(pantry): replace Cognito Hosted UI sign-in with an in-app email/password form - Hosted UI's authorization-code flow never actually completed in production because Cognito's `/oauth2/token` endpoint doesn't return CORS headers for a browser `fetch`. Sign-in/sign-up now call Cognito's IdP API directly with USER_PASSWORD_AUTH, with no email verification step and no MFA (a new pre-sign-up Lambda trigger auto-confirms accounts), and the header now shows an explicit "Sign out" label once signed in.

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
