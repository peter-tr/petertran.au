import { build } from "esbuild";
import { cpSync } from "node:fs";

const HANDLERS = ["handler.ts", "cost-refresh-handler.ts"];

await Promise.all(
  HANDLERS.map((entry) =>
    build({
      entryPoints: [entry],
      outfile: `dist/${entry.replace(/\.ts$/, ".mjs")}`,
      bundle: true,
      minify: true,
      platform: "node",
      target: "node20",
      format: "esm",
      banner: {
        js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
    })
  )
);

cpSync("schema.graphql", "dist/schema.graphql");
