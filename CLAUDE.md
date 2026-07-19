# petertran.au

npm workspaces monorepo: `infra` (AWS CDK), `api` (Apollo Server on Lambda), `web` (React + Vite).

## Workflow

- Always work on a feature branch. Never commit directly to `main`.
- Before calling something done: run typecheck, run the build, and boot the relevant dev server(s). Don't claim "it works" from static checks alone if a runtime check is available.
- Scrutinize every change before reporting it complete - re-read the diff, check for stale imports left behind by moves/renames, and grep for references you might have missed rather than assuming an edit was self-contained.
- After deploying a schema/resolver change to a service backed by real persisted data (DynamoDB), test directly against the live endpoint before calling it done - a mock/dev-server smoke test only proves the new code path works against freshly-shaped data, not against rows written before the change existed. This caught a real production outage: adding a non-nullable field to `ShoppingListEntry` broke every pre-existing row, since GraphQL null-propagates a missing non-null field to fail the whole containing list, not just that one item.
- When adding a non-nullable field to a GraphQL type backed by persisted data, the read path must backfill a default for rows written before the field existed (see `getSettings()`'s `{ ...DEFAULT_SETTINGS, ...stored }` merge, and `getShoppingList()`'s equivalent) - don't just cast stored data straight to the type and assume old rows have every current field.
- When the same string/number literal is referenced from multiple call sites (e.g. an X-Ray subsegment name passed to `traced()` from several projects), extract it to a named constant instead of repeating the literal - see `ANTHROPIC_API_SEGMENT_NAME` in `api/src/shared/xray.ts`.

## `api` workspace structure

Three independent side-project backends live as peer directories under `api/src/`: `portfolio` (resume site), `pantry`, `games/imposter`. Each deploys as its own Lambda/Function URL/DynamoDB table via its own CDK stack - deliberately separate so they evolve independently.

Each project follows the same internal layout:

- `handler.ts`, `schema.ts`, `schema.graphql`, `context.ts` - flat, at the project root
- `lib/anthropic/`, `lib/aws/`, `lib/util/` - supporting modules, grouped by what they wrap (Anthropic clients, AWS service clients, generic utilities). Pure domain logic (e.g. imposter's `game.ts`, `words.ts`) stays flat in `lib/`, not nested under a category.
- `resolvers/resolvers.ts` - real, DB-backed resolvers. Only this is imported by `handler.ts`, so only this ships in the production Lambda bundle. Keep this file to the `Query`/`Mutation` map itself (rate limiting, calling into data-access code, shaping the response) - once a project's DynamoDB CRUD/merge logic grows large enough to crowd that out, split it into `services/<domain>.ts` (one file per domain, e.g. pantry's `services/inventory.ts`/`shopping-list.ts`/`settings.ts`) rather than letting `resolvers.ts` keep growing. Not every project needs this on day one - portfolio's and imposter's resolvers are still small enough to keep their data access inline.
- `dev/dev-resolvers.ts` + `dev/dev-server.ts` - in-memory mock resolvers and the local Apollo standalone server that runs them. Keep everything mock/dev-only under `dev/` (not mixed into `resolvers/`) _and_ keep the `dev-` filename prefix even inside that folder - between the two, it's unambiguous at a glance, from the file tree alone, that these never ship to production.

### Independent versioning - `portfolio`, `pantry`, `games/imposter`, and `shared` are real workspace packages

`api/src/portfolio`, `api/src/pantry`, `api/src/games/imposter`, and `api/src/shared` each have their own `package.json` (names `portfolio`, `pantry`, `imposter`, `api-shared`) and are listed as nested entries in the root `workspaces` array - not just directories inside the `api` workspace. Each has its own `version` and gets its own `CHANGELOG.md` from Changesets, matching the fact that they already deploy as independent Lambdas/stacks.

- `api/package.json` itself only keeps the dev tooling used across all of them (`typescript`, `tsx`, `esbuild`, `@types/*`) plus anything its own `scripts/` directly imports (e.g. `@apollo/server`/`graphql` for `validate-schemas.ts`) - it no longer lists AWS SDK clients, Apollo, etc. as its own dependencies. Each project package declares only the third-party packages it actually imports.
- `api`'s `build`/`typecheck`/`dev:*` scripts are unchanged and still operate across the whole `src` tree (one `tsc --noEmit`, one chained `esbuild` per handler) - splitting into nested packages only changed dependency ownership and versioning, not the build/typecheck pipeline. esbuild still bundles each Lambda's own copy of shared code at build time, so there's no runtime cross-Lambda dependency.

### DRY - use `api/src/shared/` (package name `api-shared`)

Before writing something in one project that's the same as (or a near-copy of) something in another, check `api/src/shared/` first, and put it there instead of duplicating. It's a real workspace package (see above), imported via its `exports` map, e.g. `import { createDdbClient } from "api-shared/ddb"` - not a tsconfig path alias.

- If the logic needs per-project config (table name, rate limit, X-Ray on/off, etc.), write it as a factory function in `shared/` that takes that config as a parameter, and have each project call it with its own values - not a hardcoded shared singleton.
- If it's genuinely identical with no per-project variation (e.g. the schema.graphql loader), share it as-is.
- Don't let one project reach directly into another project's `lib/` via a relative path (e.g. `../../../portfolio/lib/ddb`) - that's a sign the code belongs in `shared/`, not that the import path needs fixing.
- A project that imports something new from `api-shared` needs that dependency's transitive third-party packages (e.g. `@anthropic-ai/sdk` for `api-shared/anthropic-client`) reachable too - `api-shared`'s own `package.json` declares those, and npm hoists them, so nothing extra is required in the consuming project's `package.json` unless it also imports that third-party package directly.
- esbuild still bundles each Lambda's own copy of shared code at build time, so there's no runtime cross-Lambda dependency, regardless of which project imports it.
- The same convention applies on the infra side at `infra/lib/shared/` (plain relative imports, no path alias needed since CDK code isn't bundled per-Lambda) - e.g. `createWarmupSchedules` in `infra/lib/shared/warmup-schedule.ts`, used by `warmup-stack.ts`.

### Learning-exercise / ops peer projects

Two more peer directories under `api/src/` exist alongside `portfolio`/`pantry`/`games/imposter`, but don't follow their GraphQL layout - they're plain-HTTP Lambdas, not Apollo servers, and (unlike those four) aren't split into their own nested workspace packages - their dependencies stay directly in `api/package.json`:

- `zero-trust-lab/` - a personal learning exercise: an edge gateway -> internal STS -> domain gateway pattern (opaque token at the edge, exchanged for a short-lived KMS-signed JWT before it reaches an internal service). Deployed via `infra/lib/zero-trust-lab-stack.ts`, fully isolated from the real site - own Cognito User Pool, own DynamoDB table, own HttpApis. See `docs/zero-trust-lab.md` for the full design writeup and what's built vs. deferred.
- `warmup/` - keeps every project's Lambda (portfolio, pantry, imposter, and zero-trust-lab's own) warm on an EventBridge Scheduler rate, toggleable from the portfolio site's `/settings` page. Deployed via `infra/lib/warmup-stack.ts` - deliberately its own stack, not folded into any producing stack, since warming is an operational/cost concern that cuts across all of them, not something specific to any one project. Every handler recognizes a fixed `{warmup: true}` invoke payload (`api/src/shared/warmup.ts`'s `isWarmupPing`) and returns immediately, before any real resolver/KMS/DynamoDB/Cognito work runs.
