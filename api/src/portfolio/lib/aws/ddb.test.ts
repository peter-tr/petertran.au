import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("portfolio's ddb client", () => {
  const originalTableName = process.env.TABLE_NAME;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalTableName === undefined) delete process.env.TABLE_NAME;
    else process.env.TABLE_NAME = originalTableName;
  });

  it("defaults TABLE_NAME to petertran-au-resume when no env var is set", async () => {
    delete process.env.TABLE_NAME;

    const { TABLE_NAME } = await import("./ddb");
    expect(TABLE_NAME).toBe("petertran-au-resume");
  });

  it("prefers the TABLE_NAME env var when set", async () => {
    process.env.TABLE_NAME = "some-other-table";

    const { TABLE_NAME } = await import("./ddb");
    expect(TABLE_NAME).toBe("some-other-table");
  });

  it("exposes a DynamoDBDocumentClient instance as ddb", async () => {
    const { ddb } = await import("./ddb");
    expect(ddb).toBeInstanceOf(DynamoDBDocumentClient);
  });

  it("exports the RESUME partition key constant", async () => {
    const { PK } = await import("./ddb");
    expect(PK).toBe("RESUME");
  });
});
