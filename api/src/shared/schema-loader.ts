import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Reads schema.graphql from alongside the caller's own module - pass the
// caller's import.meta.url so this resolves relative to the call site, not
// to this shared helper's own directory.
export function loadTypeDefs(callerImportMetaUrl: string): string {
  const currentDir = dirname(fileURLToPath(callerImportMetaUrl));
  return readFileSync(join(currentDir, "schema.graphql"), "utf-8");
}
