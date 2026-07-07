import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { ddb, TABLE_NAME } from "./ddb";

const LIMIT_PER_MINUTE = 5;
const WINDOW_SECONDS = 120;

// Simple fixed-window counter keyed by source IP + minute bucket, stored in
// the same table under its own partition-key namespace. Skips the check
// entirely when no IP is available (e.g. local dev).
export async function assertNotRateLimited(sourceIp: string | undefined): Promise<void> {
  if (!sourceIp) return;

  const bucket = Math.floor(Date.now() / 60_000);
  const ttl = Math.floor(Date.now() / 1000) + WINDOW_SECONDS;

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { pk: `RATE#${sourceIp}#${bucket}`, sk: "COUNT" },
        UpdateExpression: "ADD #count :incr SET #ttl = :ttl",
        ConditionExpression: "attribute_not_exists(#count) OR #count < :limit",
        ExpressionAttributeNames: { "#count": "count", "#ttl": "ttl" },
        ExpressionAttributeValues: { ":incr": 1, ":limit": LIMIT_PER_MINUTE, ":ttl": ttl },
      })
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      throw new Error("Too many requests - please wait a moment and try again.", { cause: err });
    }
    throw err;
  }
}
