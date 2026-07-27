// graphql-config project map - one entry per independently-schemad service
// (see CLAUDE.md's "api workspace structure": portfolio/pantry/imposter each
// deploy as their own Lambda with their own schema, deliberately never
// sharing one). Used by @graphql-eslint (eslint.config.mjs) to know which
// schema.graphql a given file belongs to when linting it, and by the VS Code
// GraphQL extension - `documents` points at each project's own /* GraphQL */
// tagged operation strings (web/src/<project>/**) so the extension can index
// them, which is what enables "Find All References" on a schema type/field,
// not just "Go to Definition".
module.exports = {
  projects: {
    portfolio: {
      schema: "api/src/portfolio/schema.graphql",
      documents: "web/src/portfolio/**/*.{ts,tsx}",
    },
    pantry: {
      schema: "api/src/pantry/schema.graphql",
      documents: "web/src/pantry/**/*.{ts,tsx}",
    },
    imposter: {
      schema: "api/src/games/imposter/schema.graphql",
      documents: "web/src/games/imposter/**/*.{ts,tsx}",
    },
    "design-studio": {
      schema: "api/src/design-studio/schema.graphql",
      documents: "web/src/design-studio/**/*.{ts,tsx}",
    },
  },
};
