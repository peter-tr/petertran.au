import { build } from "esbuild";
import { writeFileSync } from "node:fs";

// Bundles each entry as CJS (not esbuild's default ESM) - CJS uses
// require-in-the-middle for OTel auto-instrumentation, which is measurably
// faster (~4x, confirmed via live cold-start A/B testing against a real
// Lambda) than ESM's import-in-the-middle hook, which every project here
// pays for via applyApplicationSignals()'s ADOT layer.
export async function buildCjsLambdas(entries: string[]): Promise<void> {
  await Promise.all(
    entries.map(async (entry) => {
      const name = entry.replace(/\.ts$/, "");

      await build({
        entryPoints: [entry],
        outfile: `dist/${name}-bundle.js`,
        bundle: true,
        minify: true,
        platform: "node",
        target: "node20",
        format: "cjs",
        // schema-loader.ts's loadTypeDefs(import.meta.url) needs this polyfill
        // under CJS - import.meta.url doesn't exist there natively.
        define: { "import.meta.url": "IMPORT_META_URL" },
        banner: {
          js: "const { pathToFileURL } = require('url'); const IMPORT_META_URL = pathToFileURL(__filename).href;",
        },
      });

      // Unbundled on purpose: esbuild's CJS named exports are non-configurable
      // Object.defineProperty getters, which crashes OTel's require-in-the-middle
      // ("Cannot redefine property: handler") if it tries to patch the bundle
      // directly. A plain reassignment here is a configurable property instead.
      writeFileSync(`dist/${name}.js`, `module.exports.handler = require("./${name}-bundle.js").handler;\n`);
    })
  );

  // Explicit, not relied-on-by-absence - every project's package.json has
  // "type": "module", so without this, a stray future package.json copy into
  // dist/ would silently flip these .js files back to ESM interpretation.
  writeFileSync("dist/package.json", JSON.stringify({ type: "commonjs" }, null, 2) + "\n");
}
