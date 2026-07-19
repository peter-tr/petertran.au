import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { connect } from "node:net";

// Boots each service's real dev server (same in-memory mock used for local
// `npm run dev:*`) and fires a couple of basic requests through the actual
// HTTP + GraphQL + resolver stack - catches wiring bugs that a pure schema
// construction check (validate-schemas.ts) can't, e.g. a resolver throwing
// on startup, a mismatched field/resolver name, or a broken import chain.
// Deliberately shallow: one or two read-only queries per service, not
// exhaustive coverage - this is a fast "did the lights come on" check, not
// a replacement for the exhaustive testing this repo doesn't have yet.
interface ServiceCheck {
  name: string;
  script: string;
  port: number;
  queries: { query: string; check: (data: Record<string, unknown>) => boolean }[];
}

const SERVICES: ServiceCheck[] = [
  {
    name: "portfolio",
    script: "src/portfolio/dev/dev-server.ts",
    port: 4000,
    queries: [
      {
        query: "{ person { name } }",
        check: (d) => typeof (d.person as { name?: unknown })?.name === "string",
      },
    ],
  },
  {
    name: "imposter",
    script: "src/games/imposter/dev/dev-server.ts",
    port: 4001,
    queries: [{ query: "{ imposterCategories { id } }", check: (d) => Array.isArray(d.imposterCategories) }],
  },
  {
    name: "pantry",
    script: "src/pantry/dev/dev-server.ts",
    port: 4002,
    queries: [
      {
        query: "{ settings { view } }",
        check: (d) => typeof (d.settings as { view?: unknown })?.view === "string",
      },
      { query: "{ inventory { id } }", check: (d) => Array.isArray(d.inventory) },
    ],
  },
];

// A raw TCP probe, not a fetch() retry loop - fetch's connection pooling
// seemed to latch onto the first (refused) attempt and kept failing even
// after the server came up and could be reached fine via curl, which cost a
// while to track down. net.connect has no such pooling to get stuck in.
function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

async function waitForPort(port: number, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probePort(port)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out waiting for port ${port}`);
}

async function runQuery(port: number, query: string): Promise<Record<string, unknown>> {
  const res = await fetch(`http://127.0.0.1:${port}/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const json = (await res.json()) as { data?: Record<string, unknown>; errors?: { message: string }[] };
  if (json.errors?.length) {
    throw new Error(`GraphQL errors: ${json.errors.map((e) => e.message).join("; ")}`);
  }

  return json.data ?? {};
}

async function testService(service: ServiceCheck): Promise<void> {
  // Bare "tsx", not "npx tsx" - npm already put node_modules/.bin on PATH
  // for this script (it's invoked via `npm run test:e2e`), and going
  // through npx again from inside a script npx itself launched added
  // several seconds of resolution overhead per service, enough to blow
  // past the waitForPort timeout below.
  const child: ChildProcessWithoutNullStreams = spawn("tsx", [service.script], {
    stdio: "pipe",
  });
  let stderr = "";
  let stdout = "";
  child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
  child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
  child.on("error", (err) => (stderr += `spawn error: ${err.message}\n`));

  try {
    await waitForPort(service.port);
    for (const { query, check } of service.queries) {
      const data = await runQuery(service.port, query);
      if (!check(data)) {
        throw new Error(`unexpected response shape for "${query}": ${JSON.stringify(data)}`);
      }
    }
    console.log(
      `[e2e] ${service.name}: OK (${service.queries.length} check${service.queries.length > 1 ? "s" : ""})`
    );
  } catch (err) {
    console.error(`[e2e] ${service.name}: FAILED - ${err instanceof Error ? err.message : String(err)}`);
    if (stderr) console.error(`[e2e] ${service.name} stderr:\n${stderr}`);
    if (stdout) console.error(`[e2e] ${service.name} stdout:\n${stdout}`);
    throw err;
  } finally {
    child.kill();
  }
}

async function main(): Promise<void> {
  // Sequential, not concurrent - each service is only a second or two to
  // boot and check, and running 3 "npx tsx" child processes at once adds
  // process/IO contention that made this flaky without actually saving
  // meaningful time. The workflow runs this job itself in parallel with
  // validate-schemas, which is where the real time saving is.
  let failed = false;
  for (const service of SERVICES) {
    try {
      await testService(service);
    } catch {
      failed = true;
    }
  }
  if (failed) {
    console.error("[e2e] one or more services failed");
    process.exit(1);
  }
  console.log("[e2e] all services OK");
}

main();
