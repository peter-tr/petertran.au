import { createDdbClient } from "@shared/ddb";

export const { ddb, TABLE_NAME } = createDdbClient({ defaultTableName: "petertran-au-pantry" });
export const PK = "PANTRY";
