import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, copyFileSync, chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

// Pinned, not "latest" - bump deliberately, re-verify GLIBC requirement and
// end-to-end Lambda behavior (cold-start Init Duration, config compatibility)
// against a real Lambda before trusting a new version, don't auto-track.
// Bumped 2026-07-27 from the 1.x line to 2.16.0 (LTS) to pick up GA
// `telemetry.apollo.subgraph_metrics` (GraphOS Insights was warning the
// graph had never reported subgraph metrics, which requires Router >=2.7.0)
// - see router.yaml's telemetry.apollo comment for what else changed in the
// v1->v2 config migration.
const ROUTER_VERSION = "2.16.0";
const ARTIFACT = `router-v${ROUTER_VERSION}-x86_64-unknown-linux-gnu.tar.gz`;
const RELEASE_BASE = `https://github.com/apollographql/router/releases/download/v${ROUTER_VERSION}`;

const root = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(root, "..");
const distDir = join(packageRoot, "dist");

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok)
    throw new Error(`[build-router-package] failed to download ${url}: ${res.status} ${res.statusText}`);

  return Buffer.from(await res.arrayBuffer());
}

// Pulled out as a pure function so the supply-chain-integrity check itself
// (not just the network calls around it) has a real unit test - throws
// rather than returning a boolean so a mismatch can't be silently ignored
// by a caller that forgets to check a return value.
export function verifyChecksum(artifactBuf: Buffer, sumsText: string, artifactName: string): string {
  const sumsLine = sumsText.split("\n").find((line) => line.trim().endsWith(artifactName));
  if (!sumsLine) throw new Error(`[build-router-package] no sha256sums.txt entry found for ${artifactName}`);

  const expectedHash = sumsLine.trim().split(/\s+/)[0];
  const actualHash = createHash("sha256").update(artifactBuf).digest("hex");
  if (actualHash !== expectedHash) {
    throw new Error(
      `[build-router-package] sha256 mismatch for ${artifactName}: expected ${expectedHash}, got ${actualHash}`
    );
  }

  return actualHash;
}

async function main() {
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });

  console.log(`[build-router-package] downloading Router v${ROUTER_VERSION}...`);

  const [artifactBuf, sumsBuf] = await Promise.all([
    download(`${RELEASE_BASE}/${ARTIFACT}`),
    download(`${RELEASE_BASE}/sha256sums.txt`),
  ]);

  const actualHash = verifyChecksum(artifactBuf, sumsBuf.toString("utf-8"), ARTIFACT);
  console.log(`[build-router-package] sha256 verified: ${actualHash}`);

  const tmpDir = mkdtempSync(join(tmpdir(), "router-download-"));
  const tarPath = join(tmpDir, ARTIFACT);
  writeFileSync(tarPath, artifactBuf);
  // Absolute path, not a bare "tar" PATH lookup - this build script runs both
  // in CI (ubuntu-latest) and on a dev's Mac, and /usr/bin/tar exists on both.
  execFileSync("/usr/bin/tar", ["-xzf", tarPath, "-C", tmpDir]);

  const extractedBinary = join(tmpDir, "dist", "router");
  const routerOutPath = join(distDir, "router");
  copyFileSync(extractedBinary, routerOutPath);
  chmodSync(routerOutPath, 0o755);
  rmSync(tmpDir, { recursive: true, force: true });
  console.log(`[build-router-package] wrote ${routerOutPath}`);

  const bootstrapPath = join(distDir, "bootstrap");
  writeFileSync(
    bootstrapPath,
    "#!/bin/sh\n" +
      "exec /var/task/router --supergraph /var/task/supergraph.graphql --config /var/task/router.yaml --log info\n"
  );
  chmodSync(bootstrapPath, 0o755);
  console.log(`[build-router-package] wrote ${bootstrapPath}`);

  const routerYamlSourcePath = join(packageRoot, "router.yaml");
  const routerYamlOutPath = join(distDir, "router.yaml");
  copyFileSync(routerYamlSourcePath, routerYamlOutPath);
  console.log(`[build-router-package] wrote ${routerYamlOutPath}`);

  const sdlSourcePath = join(packageRoot, "supergraph.generated.graphql");
  const sdlOutPath = join(distDir, "supergraph.graphql");
  copyFileSync(sdlSourcePath, sdlOutPath);
  console.log(`[build-router-package] wrote ${sdlOutPath}`);
}

// Guarded so a test can import verifyChecksum above without also
// triggering a real network download as a side effect of the import.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
