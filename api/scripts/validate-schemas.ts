import { ApolloServer } from "@apollo/server";
import { typeDefs as portfolioTypeDefs } from "../src/portfolio/schema";
import { devResolvers as portfolioResolvers } from "../src/portfolio/dev/dev-resolvers";
import { typeDefs as imposterTypeDefs } from "../src/games/imposter/schema";
import { devResolvers as imposterResolvers } from "../src/games/imposter/dev/dev-resolvers";
import { typeDefs as pantryTypeDefs } from "../src/pantry/schema";
import { devResolvers as pantryResolvers } from "../src/pantry/dev/dev-resolvers";
import { PARSE_COMMAND_SCHEMA } from "../src/pantry/lib/anthropic/parse-command";

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

if (failed) {
  console.error("[validate-schemas] one or more checks failed");
  process.exit(1);
}
console.log("[validate-schemas] all checks passed");
