import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME, PK } from "../lib/aws/ddb";

const STATUS_SK = "PRICE_SYNC_STATUS";

// Kept short - this is "what recently went wrong", not an audit log. Oldest
// dropped first so it always reflects the most current run's problems.
const MAX_ERRORS = 10;

export interface PriceCheckError {
  itemName: string;
  message: string;
  occurredAt: string;
}

export interface PriceSyncStatus {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  totalItems: number;
  checkedItems: number;
  // From the most recently COMPLETED run - kept around after running flips
  // back to false so there's something to look at, not cleared until the
  // next run starts.
  errors: PriceCheckError[];
}

const DEFAULT_STATUS: PriceSyncStatus = {
  running: false,
  startedAt: null,
  finishedAt: null,
  totalItems: 0,
  checkedItems: 0,
  errors: [],
};

// Same backfill-merge pattern as settings.ts - a row written before a field
// existed shouldn't trip a non-null check on read.
export async function getPriceSyncStatus(): Promise<PriceSyncStatus> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: PK, sk: STATUS_SK } }));
  return { ...DEFAULT_STATUS, ...(res.Item?.data as Partial<PriceSyncStatus> | undefined) };
}

async function putPriceSyncStatus(status: PriceSyncStatus): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { pk: PK, sk: STATUS_SK, type: "PRICE_SYNC_STATUS", data: status },
    })
  );
}

export async function startPriceSync(totalItems: number): Promise<void> {
  await putPriceSyncStatus({
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    totalItems,
    checkedItems: 0,
    errors: [],
  });
}

// One write per item so a polling client sees checkedItems climb in real
// time, not just jump from 0 to totalItems at the very end.
export async function recordPriceCheckProgress(error?: PriceCheckError): Promise<void> {
  const current = await getPriceSyncStatus();
  await putPriceSyncStatus({
    ...current,
    checkedItems: current.checkedItems + 1,
    errors: error ? [...current.errors, error].slice(-MAX_ERRORS) : current.errors,
  });
}

export async function finishPriceSync(): Promise<void> {
  const current = await getPriceSyncStatus();
  await putPriceSyncStatus({ ...current, running: false, finishedAt: new Date().toISOString() });
}
