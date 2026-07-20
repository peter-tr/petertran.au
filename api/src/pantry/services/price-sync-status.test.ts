import { mockClient } from "aws-sdk-client-mock";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it } from "vitest";
import { ddb, PK } from "../lib/aws/ddb";
import {
  getPriceSyncStatus,
  startPriceSync,
  recordPriceCheckProgress,
  finishPriceSync,
  type PriceSyncStatus,
} from "./price-sync-status";

const ddbMock = mockClient(ddb);

describe("getPriceSyncStatus", () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it("returns all defaults when nothing is stored", async () => {
    ddbMock.on(GetCommand).resolves({});

    const status = await getPriceSyncStatus();

    expect(status).toEqual({
      running: false,
      startedAt: null,
      finishedAt: null,
      totalItems: 0,
      checkedItems: 0,
      errors: [],
    });
  });

  it("reads from the fixed PRICE_SYNC_STATUS sort key", async () => {
    ddbMock.on(GetCommand).resolves({});

    await getPriceSyncStatus();

    const input = ddbMock.call(0).args[0].input as { Key: { pk: string; sk: string } };
    expect(input.Key).toEqual({ pk: PK, sk: "PRICE_SYNC_STATUS" });
  });

  // Same backfill-merge pattern as settings.ts (see CLAUDE.md) - a row
  // written before a field existed must still produce a fully-populated
  // object instead of coming back with a missing non-null field.
  it("backfills missing fields on an old-shaped stored row", async () => {
    const oldShapedRow: Partial<PriceSyncStatus> = { running: true, totalItems: 5 };
    ddbMock.on(GetCommand).resolves({ Item: { data: oldShapedRow } });

    const status = await getPriceSyncStatus();

    expect(status.running).toBe(true);
    expect(status.totalItems).toBe(5);
    expect(status.startedAt).toBeNull();
    expect(status.finishedAt).toBeNull();
    expect(status.checkedItems).toBe(0);
    expect(status.errors).toEqual([]);
  });
});

describe("startPriceSync", () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it("writes a fresh running status with the given total and zeroed progress", async () => {
    ddbMock.on(PutCommand).resolves({});

    await startPriceSync(7);

    const input = ddbMock.call(0).args[0].input as { Item: { data: PriceSyncStatus } };
    expect(input.Item.data.running).toBe(true);
    expect(input.Item.data.totalItems).toBe(7);
    expect(input.Item.data.checkedItems).toBe(0);
    expect(input.Item.data.errors).toEqual([]);
    expect(input.Item.data.startedAt).not.toBeNull();
    expect(input.Item.data.finishedAt).toBeNull();
  });
});

describe("recordPriceCheckProgress", () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it("increments checkedItems without adding an error when called with none", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { data: { running: true, startedAt: "t", finishedAt: null, totalItems: 3, checkedItems: 1, errors: [] } },
    });
    ddbMock.on(PutCommand).resolves({});

    await recordPriceCheckProgress();

    const putInput = ddbMock.commandCalls(PutCommand)[0].args[0].input as { Item: { data: PriceSyncStatus } };
    expect(putInput.Item.data.checkedItems).toBe(2);
    expect(putInput.Item.data.errors).toEqual([]);
  });

  it("appends the given error to the errors list", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { data: { running: true, startedAt: "t", finishedAt: null, totalItems: 3, checkedItems: 1, errors: [] } },
    });
    ddbMock.on(PutCommand).resolves({});

    await recordPriceCheckProgress({ itemName: "Milk", message: "boom", occurredAt: "2026-01-01T00:00:00.000Z" });

    const putInput = ddbMock.commandCalls(PutCommand)[0].args[0].input as { Item: { data: PriceSyncStatus } };
    expect(putInput.Item.data.checkedItems).toBe(2);
    expect(putInput.Item.data.errors).toEqual([
      { itemName: "Milk", message: "boom", occurredAt: "2026-01-01T00:00:00.000Z" },
    ]);
  });

  it("keeps only the most recent MAX_ERRORS (10) errors, dropping the oldest first", async () => {
    const existingErrors = Array.from({ length: 10 }, (_, i) => ({
      itemName: `Item ${i}`,
      message: "old",
      occurredAt: `t${i}`,
    }));
    ddbMock.on(GetCommand).resolves({
      Item: {
        data: { running: true, startedAt: "t", finishedAt: null, totalItems: 20, checkedItems: 10, errors: existingErrors },
      },
    });
    ddbMock.on(PutCommand).resolves({});

    await recordPriceCheckProgress({ itemName: "New Item", message: "newest", occurredAt: "t-new" });

    const putInput = ddbMock.commandCalls(PutCommand)[0].args[0].input as { Item: { data: PriceSyncStatus } };
    expect(putInput.Item.data.errors).toHaveLength(10);
    // The oldest ("Item 0") was dropped, the newest is now at the end.
    expect(putInput.Item.data.errors[0].itemName).toBe("Item 1");
    expect(putInput.Item.data.errors[9].itemName).toBe("New Item");
  });
});

describe("finishPriceSync", () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it("flips running to false and sets finishedAt, preserving the rest", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        data: {
          running: true,
          startedAt: "t0",
          finishedAt: null,
          totalItems: 5,
          checkedItems: 5,
          errors: [{ itemName: "X", message: "m", occurredAt: "t1" }],
        },
      },
    });
    ddbMock.on(PutCommand).resolves({});

    await finishPriceSync();

    const putInput = ddbMock.commandCalls(PutCommand)[0].args[0].input as { Item: { data: PriceSyncStatus } };
    expect(putInput.Item.data.running).toBe(false);
    expect(putInput.Item.data.finishedAt).not.toBeNull();
    expect(putInput.Item.data.startedAt).toBe("t0");
    expect(putInput.Item.data.totalItems).toBe(5);
    expect(putInput.Item.data.errors).toEqual([{ itemName: "X", message: "m", occurredAt: "t1" }]);
  });
});
