import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const currentDir = dirname(fileURLToPath(import.meta.url));

export const typeDefs = readFileSync(join(currentDir, "schema.graphql"), "utf-8");
