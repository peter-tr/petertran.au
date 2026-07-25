import { cpSync } from "node:fs";
import { buildCjsLambdas } from "../../../scripts/build-lambda";

await buildCjsLambdas(["handler.ts"]);

cpSync("schema.graphql", "dist/schema.graphql");
