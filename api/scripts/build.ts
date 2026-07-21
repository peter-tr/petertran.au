import { build } from "esbuild";

// portfolio/pantry/imposter build via their own workspace package.json now -
// this only covers the zero-trust-lab/warm-schedule handlers, which deliberately
// stayed out of the nested-workspace split (see CLAUDE.md).
const HANDLERS = [
  "src/zero-trust-lab/idp-bridge/handler.ts",
  "src/zero-trust-lab/internal-sts/handler.ts",
  "src/zero-trust-lab/edge/authorizer.ts",
  "src/zero-trust-lab/edge/proxy.ts",
  "src/zero-trust-lab/domain-a/handler.ts",
  "src/warm-schedule/handler.ts",
];

await Promise.all(
  HANDLERS.map((entry) =>
    build({
      entryPoints: [entry],
      outfile: entry.replace(/^src\//, "dist/").replace(/\.ts$/, ".mjs"),
      bundle: true,
      platform: "node",
      target: "node20",
      format: "esm",
      banner: {
        js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
      external: ["@aws-sdk/*"],
    })
  )
);
