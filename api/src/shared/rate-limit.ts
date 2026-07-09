import { UpdateCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";

export interface RateLimiterConfig {
  ddb: DynamoDBDocumentClient;
  tableName: string;
  limitPerMinute: number;
  windowSeconds?: number;
}

// Simple fixed-window counter keyed by source IP + minute bucket, stored in
// the caller's own table under its own partition-key namespace. Skips the
// check entirely when no IP is available (e.g. local dev).
export function createRateLimiter({ ddb, tableName, limitPerMinute, windowSeconds = 120 }: RateLimiterConfig) {
  return async function assertNotRateLimited(sourceIp: string | undefined): Promise<void> {
    if (!sourceIp) return;

    const bucket = Math.floor(Date.now() / 60_000);
    const ttl = Math.floor(Date.now() / 1000) + windowSeconds;

    try {
      await ddb.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { pk: `RATE#${sourceIp}#${bucket}`, sk: "COUNT" },
          UpdateExpression: "ADD #count :incr SET #ttl = :ttl",
          ConditionExpression: "attribute_not_exists(#count) OR #count < :limit",
          ExpressionAttributeNames: { "#count": "count", "#ttl": "ttl" },
          ExpressionAttributeValues: { ":incr": 1, ":limit": limitPerMinute, ":ttl": ttl },
        })
      );
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        throw new Error("Too many requests - please wait a moment and try again.", { cause: err });
      }
      throw err;
    }
  };
}
