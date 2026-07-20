import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";

// Copies every item from `sourceTable` into `destTable`, after first wiping
// whatever's already in `destTable`. Used to refresh a test-env DynamoDB
// table (e.g. pantry-test) from a temporary table restored from a prod
// on-demand backup (see refresh-test-env-data.yml) - restore-table-from-backup
// always creates a brand-new table, it can't restore in place into an
// existing one, so this script is what actually gets the data into the
// CDK-managed `-test` table without changing that table's identity.
const [, , sourceTable, destTable] = process.argv;
if (!sourceTable || !destTable) {
  console.error("Usage: tsx scripts/refresh-test-table.ts <sourceTable> <destTable>");
  process.exit(1);
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

async function scanAll(tableName: string): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new ScanCommand({ TableName: tableName, ExclusiveStartKey: lastEvaluatedKey })
    );
    items.push(...((page.Items ?? []) as Record<string, unknown>[]));
    lastEvaluatedKey = page.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return items;
}

// DynamoDB caps BatchWriteItem at 25 requests per call.
async function batchWrite(
  tableName: string,
  requests: {
    PutRequest?: { Item: Record<string, unknown> };
    DeleteRequest?: { Key: Record<string, unknown> };
  }[]
): Promise<void> {
  for (let i = 0; i < requests.length; i += 25) {
    const chunk = requests.slice(i, i + 25);
    await ddb.send(new BatchWriteCommand({ RequestItems: { [tableName]: chunk } }));
  }
}

async function main() {
  console.log(`Wiping existing items in ${destTable}...`);

  const existing = await scanAll(destTable);
  await batchWrite(
    destTable,
    existing.map((item) => ({ DeleteRequest: { Key: { pk: item.pk, sk: item.sk } } }))
  );
  console.log(`Deleted ${existing.length} existing item(s) from ${destTable}.`);

  console.log(`Copying items from ${sourceTable} into ${destTable}...`);

  const toCopy = await scanAll(sourceTable);
  await batchWrite(
    destTable,
    toCopy.map((item) => ({ PutRequest: { Item: item } }))
  );
  console.log(`Copied ${toCopy.length} item(s) from ${sourceTable} into ${destTable}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
