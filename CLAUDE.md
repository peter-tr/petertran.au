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

### DRY - use `api/src/shared/`

Before writing something in one project that's the same as (or a near-copy of) something in another, check `api/src/shared/` first, and put it there instead of duplicating. It's referenced via the `@shared/*` tsconfig path alias (not a real npm package - just a directory + path mapping), e.g. `import { createDdbClient } from "@shared/ddb"`.

- If the logic needs per-project config (table name, rate limit, X-Ray on/off, etc.), write it as a factory function in `shared/` that takes that config as a parameter, and have each project call it with its own values - not a hardcoded shared singleton.
- If it's genuinely identical with no per-project variation (e.g. the schema.graphql loader), share it as-is.
- Don't let one project reach directly into another project's `lib/` via a relative path (e.g. `../../../portfolio/lib/ddb`) - that's a sign the code belongs in `shared/`, not that the import path needs fixing.
- esbuild and `tsx` both resolve `@shared/*` natively via `api/tsconfig.json`'s `paths` - each Lambda bundles its own copy of shared code at build time, so there's no runtime cross-Lambda dependency.
