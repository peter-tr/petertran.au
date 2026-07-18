import { createRequire } from "node:module";
import { ApolloServer } from "@apollo/server";
import { buildSchema, parse, validate } from "graphql";
import { typeDefs as portfolioTypeDefs } from "../src/portfolio/schema";
import { devResolvers as portfolioResolvers } from "../src/portfolio/dev/dev-resolvers";
import { typeDefs as imposterTypeDefs } from "../src/games/imposter/schema";
import { devResolvers as imposterResolvers } from "../src/games/imposter/dev/dev-resolvers";
import { typeDefs as pantryTypeDefs } from "../src/pantry/schema";
import { devResolvers as pantryResolvers } from "../src/pantry/dev/dev-resolvers";
import { PARSE_COMMAND_SCHEMA } from "../src/pantry/lib/anthropic/parse-command";

// require(), not a static `import` - the web workspace has its own tsconfig
// (Vite ambient types, DOM lib) that api's doesn't share, so a type-level
// import here would pull those files into *api*'s tsc program and fail on
// things like `import.meta.env` that only Vite's types know about. require()
// only needs tsx's runtime transform, not type-checking, which is all this
// script actually needs from these modules - the raw exported query strings.
const require = createRequire(import.meta.url);
const portfolioApi: Record<string, unknown> = require("../../web/src/portfolio/lib/graphql.ts");
const imposterApi: Record<string, unknown> = require("../../web/src/games/imposter/lib/api.ts");
const pantryApi: Record<string, unknown> = require("../../web/src/pantry/api.ts");

// Catches SDL-level bugs that neither tsc nor esbuild can see - both just
// treat schema.graphql as an opaque string. This is the exact check that
// would have caught the "Mutation.updateShoppingListEntry can only be
// defined once" outage on 2026-07-10: a merge duplicated a field across two
// non-adjacent parts of the file, which git's line-based diff didn't flag
// as a conflict, but GraphQL's schema validator rejects immediately.
// devResolvers (not the real DB-backed resolvers) is enough here - schema
// construction throws on bad SDL regardless of which resolver map backs it,
// and using the mock avoids needing AWS credentials for a check this cheap.
const GRAPHQL_SERVICES = [
  { name: "portfolio", typeDefs: portfolioTypeDefs, resolvers: portfolioResolvers },
  { name: "imposter", typeDefs: imposterTypeDefs, resolvers: imposterResolvers },
  { name: "pantry", typeDefs: pantryTypeDefs, resolvers: pantryResolvers },
];

// Anthropic's structured-output API rejects any json_schema with more than
// this many nullable/union-typed ("anyOf") parameters. This is the exact
// check that would have caught the parseCommand outage on 2026-07-10: adding
// 3 more anyOf fields silently pushed the schema from 15 to 18, and every
// request started failing with a 400 from Anthropic - only visible at
// request time, never at build time.
const ANTHROPIC_UNION_PARAM_LIMIT = 16;
const WARN_WITHIN = 2;

function countUnionParams(node: unknown): number {
  if (Array.isArray(node)) return node.reduce((sum: number, n) => sum + countUnionParams(n), 0);
  if (node && typeof node === "object") {
    let count = Array.isArray((node as { anyOf?: unknown }).anyOf) ? 1 : 0;
    for (const value of Object.values(node)) count += countUnionParams(value);
    return count;
  }
  return 0;
}

const ANTHROPIC_SCHEMAS = [{ name: "pantry parseCommand", schema: PARSE_COMMAND_SCHEMA }];

let failed = false;

for (const { name, typeDefs, resolvers } of GRAPHQL_SERVICES) {
  try {
    new ApolloServer({ typeDefs, resolvers });
    console.log(`[schema] ${name}: OK`);
  } catch (err) {
    failed = true;
    console.error(`[schema] ${name}: FAILED - ${err instanceof Error ? err.message : String(err)}`);
  }
}

for (const { name, schema } of ANTHROPIC_SCHEMAS) {
  const count = countUnionParams(schema);
  if (count > ANTHROPIC_UNION_PARAM_LIMIT) {
    failed = true;
    console.error(
      `[anthropic-schema] ${name}: FAILED - ${count} union-typed params, Anthropic's limit is ${ANTHROPIC_UNION_PARAM_LIMIT}`
    );
  } else if (count >= ANTHROPIC_UNION_PARAM_LIMIT - WARN_WITHIN) {
    console.warn(
      `[anthropic-schema] ${name}: ${count}/${ANTHROPIC_UNION_PARAM_LIMIT} union-typed params - getting close to Anthropic's limit`
    );
  } else {
    console.log(`[anthropic-schema] ${name}: OK (${count}/${ANTHROPIC_UNION_PARAM_LIMIT})`);
  }
}

// Catches the class of bug that broke the live Pantry page on 2026-07-18:
// PANTRY_HOME_QUERY combined two fragments that each independently
// self-embedded a shared dependency, so the *composed* request string ended
// up with that fragment defined twice - invalid per GraphQL's "unique
// fragment names" rule, rejected by Apollo Server at request time. Neither
// tsc (which only sees these as untyped strings) nor graphql-codegen (which
// parses each tagged template's own source text, never the actual runtime
// ${...} concatenation) can see this - only parsing the real, fully-
// interpolated string catches it, which is exactly what importing each
// service's own frontend module and validating its exports gives us.
//
// Every service's api module exports its query/mutation strings as plain
// `export const X = ...`, so scanning for exported values that look like an
// operation (rather than maintaining a hand-kept list here) means a newly
// added query gets covered automatically, with nothing to remember to update.
const FRONTEND_QUERY_SERVICES = [
  { name: "portfolio", typeDefs: portfolioTypeDefs, module: portfolioApi },
  { name: "imposter", typeDefs: imposterTypeDefs, module: imposterApi },
  { name: "pantry", typeDefs: pantryTypeDefs, module: pantryApi },
];

for (const { name, typeDefs, module } of FRONTEND_QUERY_SERVICES) {
  const schema = buildSchema(typeDefs);
  let checked = 0;
  let serviceFailed = false;

  for (const [exportName, value] of Object.entries(module)) {
    if (typeof value !== "string" || !/^\s*(query|mutation)\b/.test(value)) continue;
    checked++;

    try {
      const errors = validate(schema, parse(value));
      if (errors.length > 0) {
        failed = true;
        serviceFailed = true;
        console.error(`[frontend-query] ${name}.${exportName}: FAILED`);
        for (const error of errors) console.error(`  - ${error.message}`);
      }
    } catch (err) {
      failed = true;
      serviceFailed = true;
      console.error(
        `[frontend-query] ${name}.${exportName}: FAILED - ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (!serviceFailed) {
    console.log(`[frontend-query] ${name}: OK (${checked} operation${checked === 1 ? "" : "s"})`);
  }
}

if (failed) {
  console.error("[validate-schemas] one or more checks failed");
  process.exit(1);
}
console.log("[validate-schemas] all checks passed");
