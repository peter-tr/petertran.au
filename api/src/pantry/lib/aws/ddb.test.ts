import { describe, expect, it, vi } from "vitest";

const createDdbClient = vi.fn<(...args: unknown[]) => { ddb: unknown; TABLE_NAME: string }>(() => ({
  ddb: { fake: true },
  TABLE_NAME: "resolved-table",
}));

vi.mock("api-shared/ddb", () => ({
  createDdbClient: (...args: unknown[]) => createDdbClient(...args),
}));

// Imported after the mock so the module picks up the mocked createDdbClient.
const { ddb, TABLE_NAME, PK } = await import("./ddb");

describe("pantry ddb client", () => {
  it("configures createDdbClient with pantry's own default table name and xray enabled", () => {
    expect(createDdbClient).toHaveBeenCalledWith({ defaultTableName: "petertran-au-pantry", xray: true });
  });

  it("re-exports the ddb client and table name from createDdbClient", () => {
    expect(ddb).toEqual({ fake: true });
    expect(TABLE_NAME).toBe("resolved-table");
  });

  it("uses the fixed PANTRY partition key", () => {
    expect(PK).toBe("PANTRY");
  });
});
