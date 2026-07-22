import { defineConfig } from "vitest/config";

// Covers only the projects that aren't split into their own nested workspace
// packages (see CLAUDE.md) - portfolio/pantry/imposter/shared each run their
// own vitest via their own package.json's "test" script.
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/zero-trust-lab/**/*.test.ts",
      "src/warmup/**/*.test.ts",
      "src/warm-schedule/**/*.test.ts",
      "src/alerts-settings/**/*.test.ts",
    ],
  },
});
