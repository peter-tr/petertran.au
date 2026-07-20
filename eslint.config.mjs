import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";
import globals from "globals";
import graphqlPlugin from "@graphql-eslint/eslint-plugin";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/cdk.out/**", "**/node_modules/**", ".claude/worktrees/**", "**/.tsbuild/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "*", next: "return" },
        { blankLine: "always", prev: "*", next: ["const", "let", "var"] },
        { blankLine: "any", prev: ["const", "let", "var"], next: ["const", "let", "var"] },
      ],
    },
  },
  {
    files: ["*.js"],
    languageOptions: { globals: { ...globals.node }, sourceType: "commonjs" },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: { globals: { ...globals.node }, sourceType: "module" },
  },
  // Each api/src project owns its own lib/ - reaching into a sibling
  // project's lib/ via a relative import is a sign that code belongs in
  // api/src/shared/ instead (see CLAUDE.md's "DRY - use api/src/shared/").
  // This turns that convention into a lint error instead of relying on
  // review to catch it.
  ...["portfolio", "pantry", "games/imposter", "zero-trust-lab"].map((project) => ({
    files: [`api/src/${project}/**/*.ts`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: ["portfolio", "pantry", "games/imposter", "zero-trust-lab"]
            .filter((other) => other !== project)
            .map((other) => ({
              group: [`**/${other}/lib/**`],
              message: `Importing from ${other}'s lib/ - move shared logic to api/src/shared/ instead.`,
            })),
        },
      ],
    },
  })),
  {
    files: ["web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  // Each of the 3 services' schema.graphql is self-contained (no cross-schema
  // references), so it's linted against itself rather than needing a single
  // combined schema pointer.
  {
    files: ["api/src/*/schema.graphql", "api/src/games/imposter/schema.graphql"],
    languageOptions: { parser: graphqlPlugin.parser },
    plugins: { "@graphql-eslint": graphqlPlugin },
    rules: {
      ...graphqlPlugin.configs["flat/schema-recommended"].rules,
      // Relay-style convention (every object type needs a unique `id: ID!`)
      // - doesn't fit this schema's deliberate design, which has plenty of
      // legitimate id-less types (singletons like PantrySettings/Person,
      // nested value objects like Purchase/Link/RecipeIngredient).
      "@graphql-eslint/strict-id-in-types": "off",
    },
  },
  prettier
);
