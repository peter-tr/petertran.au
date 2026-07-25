import { cpSync } from "node:fs";
import { buildCjsLambdas } from "../../../scripts/build-lambda";

await buildCjsLambdas(["handler.ts", "digest-handler.ts", "price-check-handler.ts"]);

cpSync("schema.graphql", "dist/schema.graphql");
