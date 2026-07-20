import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./xray", () => ({
  captureAwsClient: vi.fn((client: unknown) => client),
}));

import { createDdbClient } from "./ddb";
import { captureAwsClient } from "./xray";

const mockedCaptureAwsClient = vi.mocked(captureAwsClient);

describe("createDdbClient", () => {
  const originalTableName = process.env.TABLE_NAME;

  beforeEach(() => {
    mockedCaptureAwsClient.mockClear();
    delete process.env.TABLE_NAME;
  });

  afterEach(() => {
    if (originalTableName === undefined) {
      delete process.env.TABLE_NAME;
    } else {
      process.env.TABLE_NAME = originalTableName;
    }
  });

  it("falls back to the caller's defaultTableName when TABLE_NAME is unset", () => {
    const client = createDdbClient({ defaultTableName: "my-default-table" });

    expect(client.TABLE_NAME).toBe("my-default-table");
  });

  it("prefers the TABLE_NAME environment variable over defaultTableName", () => {
    process.env.TABLE_NAME = "env-table-override";

    const client = createDdbClient({ defaultTableName: "my-default-table" });

    expect(client.TABLE_NAME).toBe("env-table-override");
  });

  it("returns a real DynamoDBDocumentClient wrapping the raw client", () => {
    const client = createDdbClient({ defaultTableName: "t" });

    expect(client.ddb).toBeInstanceOf(DynamoDBDocumentClient);
  });

  it("does not wrap the client with X-Ray capture when xray is omitted (defaults false)", () => {
    createDdbClient({ defaultTableName: "t" });

    expect(mockedCaptureAwsClient).not.toHaveBeenCalled();
  });

  it("does not wrap the client with X-Ray capture when xray is explicitly false", () => {
    createDdbClient({ defaultTableName: "t", xray: false });

    expect(mockedCaptureAwsClient).not.toHaveBeenCalled();
  });

  it("wraps the client with X-Ray capture when xray is true", () => {
    createDdbClient({ defaultTableName: "t", xray: true });

    expect(mockedCaptureAwsClient).toHaveBeenCalledTimes(1);
  });
});
