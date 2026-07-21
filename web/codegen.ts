import type { CodegenConfig } from "@graphql-codegen/cli";

// Each of the 3 pantry/portfolio/imposter GraphQL APIs' schema.graphql is the
// single source of truth - this generates TypeScript types straight from it
// for every query/mutation/fragment already defined (as /* GraphQL */-tagged
// template literals) in that service's own api.ts/graphql.ts, so a query
// asking for a field the schema doesn't have fails `npm run codegen` instead
// of shipping a runtime 500 (see the 2026-07 pantry command bar outage this
// was built in response to).
//
// Each service gets 2 output files, not 1 - typescript-operations v6 has a
// known bug (graphql-code-generator#10782) where combining `typescript` +
// `typescript-operations` in one output re-declares every input/enum type
// used by an operation's variables, causing TS2300 "Duplicate identifier".
// The documented workaround is what's below: base schema types go to their
// own `*-schema-types.generated.ts` via `typescript` alone, and the
// operations file uses `typescript-operations` with `importSchemaTypesFrom`
// pointing back at it instead of re-emitting those types itself.
function serviceConfig(
  schemaPath: string,
  documentsGlob: string,
  schemaTypesImportPath: string,
  schemaTypesConfig: Record<string, unknown> = {}
) {
  return {
    schemaTypes: {
      schema: schemaPath,
      plugins: ["typescript"],
      config: schemaTypesConfig,
    },
    operations: {
      schema: schemaPath,
      documents: [documentsGlob, documentsGlob.replace("*.{ts,tsx}", "*.generated.ts")].map((g, i) =>
        i === 0 ? g : `!${g}`
      ),
      plugins: ["typescript-operations"],
      config: { importSchemaTypesFrom: schemaTypesImportPath },
    },
  };
}

const portfolio = serviceConfig(
  "../api/src/portfolio/schema.graphql",
  "src/portfolio/**/*.{ts,tsx}",
  "src/portfolio/lib/graphql-schema-types.generated.ts"
);
// Real TS enums (the plugin default, same as imposter) rather than plain
// string literal unions - StorageLocation.Fridge, not the bare string
// "FRIDGE", is the safer pattern: it's a compile error to pass a
// misspelled/stale string where an enum is expected, which a literal union
// alone doesn't catch as reliably once the value flows through a few
// non-literal call sites.
const pantry = serviceConfig(
  "../api/src/pantry/schema.graphql",
  "src/pantry/**/*.{ts,tsx}",
  "src/pantry/api-schema-types.generated.ts"
);
const imposter = serviceConfig(
  "../api/src/games/imposter/schema.graphql",
  "src/games/imposter/**/*.{ts,tsx}",
  "src/games/imposter/lib/api-schema-types.generated.ts"
);
const designStudio = serviceConfig(
  "../api/src/design-studio/schema.graphql",
  "src/design-studio/**/*.{ts,tsx}",
  "src/design-studio/api-schema-types.generated.ts"
);

const config: CodegenConfig = {
  overwrite: true,
  generates: {
    "src/portfolio/lib/graphql-schema-types.generated.ts": portfolio.schemaTypes,
    "src/portfolio/lib/graphql.generated.ts": portfolio.operations,
    "src/pantry/api-schema-types.generated.ts": pantry.schemaTypes,
    "src/pantry/api.generated.ts": pantry.operations,
    "src/games/imposter/lib/api-schema-types.generated.ts": imposter.schemaTypes,
    "src/games/imposter/lib/api.generated.ts": imposter.operations,
    "src/design-studio/api-schema-types.generated.ts": designStudio.schemaTypes,
    "src/design-studio/api.generated.ts": designStudio.operations,
  },
};

export default config;
