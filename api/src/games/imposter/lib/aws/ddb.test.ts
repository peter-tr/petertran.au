import { beforeEach, describe, expect, it, vi } from "vitest";

const createDdbClient = vi.fn<(config: { defaultTableName: string; xray?: boolean }) => unknown>(() => ({
  ddb: "the-ddb-client",
  TABLE_NAME: "the-table-name",
}));

// vi.mock calls are hoisted above imports by vitest's transform, so ddb.ts
// (imported below) picks up this mocked createDdbClient.
vi.mock("api-shared/ddb", () => ({
  createDdbClient: (config: { defaultTableName: string; xray?: boolean }) => createDdbClient(config),
}));

describe("imposter's ddb client wiring", () => {
  beforeEach(() => {
    createDdbClient.mockClear();
    vi.resetModules();
  });

  it("configures the shared ddb client factory with this project's default table name and X-Ray tracing on", async () => {
    await import("./ddb");

    expect(createDdbClient).toHaveBeenCalledWith({ defaultTableName: "petertran-au-imposter", xray: true });
  });

  it("re-exports whatever the shared factory returns", async () => {
    const mod = (await import("./ddb")) as unknown as { ddb: unknown; TABLE_NAME: unknown };

    expect(mod.ddb).toBe("the-ddb-client");
    expect(mod.TABLE_NAME).toBe("the-table-name");
  });
});
