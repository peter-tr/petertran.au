# Pantry

Fridge/pantry inventory tracker at [petertran.au/pantry](https://petertran.au/pantry) - manual
CRUD on inventory and a shopping list, plus an AI natural-language command bar
layered on top of the same data.

Follows the layout described in the repo root `CLAUDE.md`: `handler.ts` /
`schema.ts` / `schema.graphql` / `context.ts` at the root, `lib/` for
supporting code, `resolvers/resolvers.ts` for the real GraphQL `Query`/
`Mutation` map (the only thing `handler.ts` imports, so it's the only thing
that ships in the Lambda bundle), and `dev/dev-resolvers.ts` +
`dev/dev-server.ts` for the in-memory mock used by local dev.

`resolvers.ts` itself stays thin - rate limiting, calling into the data
layer, and shaping the GraphQL response. The actual DynamoDB CRUD and
merge/backfill logic lives in `services/` (`inventory.ts`,
`shopping-list.ts`, `settings.ts`), one file per domain, since that logic
has nothing to do with GraphQL and both `send-digest.ts` and
`parse-command.ts` need it without pulling in the whole resolver map (and,
transitively, the Anthropic SDK - `digest-handler.mjs` dropped from ~720kB
to ~275kB once it stopped doing that).

## AI command bar (`lib/anthropic/parse-command.ts`)

A single `parseCommand(input, history, ...)` call classifies free-text input
into one of four modes - `answer` (read-only question), `actions` (proposed
inventory/shopping-list changes, always previewed and confirmed client-side,
never auto-applied), `recipes` (1-3 suggestions with live servings scaling,
AUD price estimates, and have/missing/insufficient ingredient checking
against real inventory), or `unclear`.

**Hard constraint**: Anthropic's structured-output `json_schema` format
rejects a schema with more than 16 `anyOf`/nullable-typed ("union") fields.
`PARSE_COMMAND_SCHEMA` is exported specifically so
`api/scripts/validate-schemas.ts` can count them on every CI run and fail
before 16 is exceeded - this schema has already caused one production outage
by silently going over that limit (fixed by replacing three separate
nullable boolean fields with the `flagsSet`/`flagsClear` plain-array
pattern - see the comment on `RawAction`). When adding a new optional field
to this schema, prefer a plain (non-nullable) type or an array over
`anyOf: [..., {type: "null"}]` wherever the semantics allow it, since only
nullable/union fields count against the budget.

## Digest email (`lib/aws/send-digest.ts`, `digest-handler.ts`)

A separate Lambda (not the GraphQL one - this is cron-triggered, not HTTP)
that emails a summary of shopping-list items marked `urgent`. Skips sending
entirely if there are none.

The EventBridge Scheduler rule (`infra/lib/pantry-stack.ts`) fires **hourly**,
Sydney-local time - not once a day at a fixed hour. The actual "send at 4pm"
behavior is app data, not infrastructure: `PantrySettings.digestEnabled` and
`digestHour` (configurable from the `/pantry/settings` page) are checked on
every hourly invocation, and the handler no-ops unless the current Sydney
hour matches. This means the send time can be changed from the settings page
without a redeploy.

## CI safeguards

Two scripts in `api/scripts/` (shared across all three `api/src/*` services,
not pantry-specific) run as parallel GitHub Actions jobs the `deploy` job
depends on:

- `validate-schemas.ts` - constructs each service's `ApolloServer` against
  its real SDL + dev resolvers, catching schema bugs (like a duplicate field
  definition, which has also caused a production outage here) that neither
  `tsc` nor `esbuild` catch since they treat `.graphql` as an opaque string.
  Also runs the Anthropic schema union-count check described above.
- `e2e-smoke.ts` - boots each service's real dev server and fires a basic
  query against it.

## Non-nullable field backfill

Every field on `ShoppingListEntry`, `InventoryItem`, and `PantrySettings` is
persisted in DynamoDB. Adding a new **non-nullable** field to any of these
requires a default in that type's merge/backfill function in the matching
`services/` file (`settings.ts`'s `getSettings()` `{ ...DEFAULT_SETTINGS,
...stored }` spread, `shopping-list.ts`'s `withShoppingListDefaults()`,
`inventory.ts`'s `withInventoryDefaults()`) - rows written before the field
existed won't have it, and GraphQL null-propagates a missing non-null field
to fail the *entire containing list*, not just that one row. This caused a
real production outage the first time a non-nullable field was added
without a backfill.
