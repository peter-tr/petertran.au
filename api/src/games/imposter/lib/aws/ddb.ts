import { createDdbClient } from "@shared/ddb";

export const { ddb, TABLE_NAME } = createDdbClient({ defaultTableName: "petertran-au-imposter", xray: true });
