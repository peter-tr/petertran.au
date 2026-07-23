import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME } from "../lib/aws/ddb";
import { DEFAULT_PK } from "../context";

// A separate registry, under its own fixed pk ("USERS"), of every signed-up
// user's pantry pk - not derivable from the inventory/settings/shopping-list
// items themselves (those are only ever queried scoped to one pk at a time).
// The scheduled digest/price-check Lambdas need this to loop over every
// user's pantry instead of just the single shared one.
const USERS_PK = "USERS";
const USER_PREFIX = "USER#";

interface UserRecord {
  pk: string;
  email: string;
  createdAt: string;
}

// Idempotent - safe to call on every login. Preserves the original
// createdAt on repeat calls rather than resetting it.
export async function registerUser(pk: string, email: string): Promise<void> {
  const existing = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { pk: USERS_PK, sk: `${USER_PREFIX}${pk}` } })
  );
  const createdAt = (existing.Item?.data as UserRecord | undefined)?.createdAt ?? new Date().toISOString();

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: USERS_PK,
        sk: `${USER_PREFIX}${pk}`,
        type: "USER",
        data: { pk, email, createdAt } satisfies UserRecord,
      },
    })
  );
}

// Every registered user's pk, plus DEFAULT_PK - so a scheduled job that
// loops over this list keeps covering the shared/default pantry exactly as
// it did before multi-user support existed.
export async function listAllPantryPks(): Promise<string[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":pk": USERS_PK, ":prefix": USER_PREFIX },
    })
  );

  const userPks = (res.Items ?? []).map((i) => (i.data as UserRecord).pk);

  return [DEFAULT_PK, ...userPks];
}
