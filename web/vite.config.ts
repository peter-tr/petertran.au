import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  worker: {
    format: "es",
  },
  optimizeDeps: {
    esbuildOptions: {
      plugins: [
        // GraphiQL's Monaco editor loads its workers via `?worker` imports,
        // which Vite's dev server handles natively at request time - but the
        // dependency-optimizer's esbuild *scan* doesn't know about that
        // convention and tries to literally read a file at a path ending in
        // "?worker", which doesn't exist, crashing the whole dev server.
        // Marking just these specifiers external (during the scan/prebundle
        // only, not the real production build) skips that read without
        // excluding the parent packages - which would otherwise stop the
        // optimizer from walking (and correctly CJS-interop'ing) everything
        // *else* those packages depend on.
        {
          name: "ignore-vite-worker-suffix",
          setup(build) {
            build.onResolve({ filter: /\?worker$/ }, (args) => ({ path: args.path, external: true }));
          },
        },
      ],
    },
  },
});
