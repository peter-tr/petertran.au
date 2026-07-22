import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Root, not `web/` - the dev-server commands below are each other workspace's
// `npm run dev:*` script, same ones `npm run dev` (turbo) starts locally.
const REPO_ROOT = path.resolve(import.meta.dirname, "..");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "html",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    contextOptions: {
      // Hero's terminal-typing effect skips straight to the full query
      // under reduced motion (see Hero.tsx's prefersReducedMotion check) -
      // without this, a screenshot could land mid-animation and fail the
      // pixel diff for no real reason.
      reducedMotion: "reduce",
    },
  },
  expect: {
    toHaveScreenshot: {
      // Native form controls (e.g. the pantry category <select>) render
      // with a couple pixels of sub-pixel/anti-aliasing jitter between runs
      // even with nothing actually changed - a small tolerance absorbs that
      // without masking real regressions, which move far more than 2%.
      maxDiffPixelRatio: 0.02,
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Taller than Hero's own content (~800px) - otherwise Playwright's
        // element-screenshot has to virtually expand the capture area to
        // fit it in one shot, which sweeps the site's `position: sticky`
        // Nav bar (pinned to the page's real top, not part of `.hero`) into
        // frame too, since it's slightly wider than `.hero`'s own box.
        viewport: { width: 1280, height: 1000 },
      },
    },
    {
      name: "mobile-chromium",
      use: {
        // Pixel 7's own viewport/UA/touch, not an iOS preset - iOS device
        // presets default to WebKit, which would mean downloading and
        // caching a second browser just for this. Chromium's mobile
        // emulation (viewport + UA + touch) already exercises the same
        // `max-width: 640px` CSS breakpoints real-user Android/Chrome
        // traffic would hit, without that cost.
        ...devices["Pixel 7"],
        // Real device height (839) is nowhere near tall enough for Hero's
        // ~1000px reflowed height at this width - same oversized-element/
        // sticky-nav bleed as the desktop project, just worse (narrower
        // width wraps more text, so Hero is taller here than on desktop).
        viewport: { width: 412, height: 1400 },
        // Real device pixel ratio (2.625) triples screenshot pixel counts
        // for no real fidelity gain in a layout/regression check - keeping
        // this at 1 keeps the diffing (and the committed PNGs) fast small.
        deviceScaleFactor: 1,
      },
    },
  ],
  // Each service's real dev server (in-memory mock, no AWS) - same ones
  // `npm run dev` boots locally - so these tests exercise real GraphQL wiring
  // against deterministic fixture data, not production.
  webServer: [
    {
      command: "npm run dev:portfolio --workspace=api",
      cwd: REPO_ROOT,
      url: "http://localhost:4000/",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npm run dev:pantry --workspace=api",
      cwd: REPO_ROOT,
      url: "http://localhost:4002/",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npm run dev:imposter --workspace=api",
      cwd: REPO_ROOT,
      url: "http://localhost:4001/",
      reuseExistingServer: !process.env.CI,
    },
    {
      // Composes the three subgraphs above into one endpoint - web's
      // .env.development points every VITE_*_GRAPHQL_ENDPOINT here, not at
      // a subgraph directly, so e2e exercises the same supergraph path
      // prod/test traffic takes instead of bypassing it.
      command: "npm run dev:supergraph --workspace=api",
      cwd: REPO_ROOT,
      url: "http://localhost:4003/",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npm run dev --workspace=web",
      cwd: REPO_ROOT,
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
    },
  ],
});
