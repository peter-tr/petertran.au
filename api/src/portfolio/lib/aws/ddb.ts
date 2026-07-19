import { createDdbClient } from "api-shared/ddb";

// Only the resume API traces to X-Ray - its systemStats dashboard shows a
// Lambda/DynamoDB/Anthropic timing breakdown per operation.
export const { ddb, TABLE_NAME } = createDdbClient({ defaultTableName: "petertran-au-resume", xray: true });
export const PK = "RESUME";
