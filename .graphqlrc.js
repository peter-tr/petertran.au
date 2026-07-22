// graphql-config project map - one entry per independently-schemad service
// (see CLAUDE.md's "api workspace structure": portfolio/pantry/imposter each
// deploy as their own Lambda with their own schema, deliberately never
// sharing one). Used by @graphql-eslint (eslint.config.mjs) to know which
// schema.graphql a given file belongs to when linting it.
module.exports = {
  projects: {
    portfolio: {
      schema: "api/src/portfolio/schema.graphql",
    },
    pantry: {
      schema: "api/src/pantry/schema.graphql",
    },
    imposter: {
      schema: "api/src/games/imposter/schema.graphql",
    },
    "design-studio": {
      schema: "api/src/design-studio/schema.graphql",
    },
  },
};
