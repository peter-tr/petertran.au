import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadTypeDefs } from "./schema-loader";

describe("loadTypeDefs", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "schema-loader-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads schema.graphql from alongside the caller's module, not this helper's own directory", () => {
    const contents = "type Query {\n  hello: String\n}\n";
    writeFileSync(join(dir, "schema.graphql"), contents, "utf-8");

    // Simulate a caller module living at <dir>/handler.ts.
    const callerImportMetaUrl = pathToFileURL(join(dir, "handler.ts")).href;

    expect(loadTypeDefs(callerImportMetaUrl)).toBe(contents);
  });

  it("resolves relative to a nested caller path, not the process cwd", () => {
    const nested = join(dir, "nested", "deeper");
    writeFileSync(join(dir, "schema.graphql"), "type Query { a: Int }", "utf-8");
    // Put a *different* schema.graphql at the top level and the real one nested,
    // to prove it reads from the caller's own directory rather than cwd/dir root.
    mkdirSync(nested, { recursive: true });

    const nestedContents = "type Query { nested: Boolean }";
    writeFileSync(join(nested, "schema.graphql"), nestedContents, "utf-8");

    const callerImportMetaUrl = pathToFileURL(join(nested, "schema.ts")).href;

    expect(loadTypeDefs(callerImportMetaUrl)).toBe(nestedContents);
  });

  it("throws when no schema.graphql exists alongside the caller", () => {
    const callerImportMetaUrl = pathToFileURL(join(dir, "handler.ts")).href;

    expect(() => loadTypeDefs(callerImportMetaUrl)).toThrow(/ENOENT/);
  });
});
