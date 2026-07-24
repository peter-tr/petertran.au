import { createDdbClient } from "api-shared/ddb";

export const { ddb, TABLE_NAME } = createDdbClient({ defaultTableName: "petertran-au-imposter" });
