import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME, PK } from "./ddb";

export interface ResumeItem {
  sk: string;
  type: string;
  data: unknown;
}

async function queryResumePartition(): Promise<ResumeItem[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": PK },
    })
  );

  return (res.Items ?? []) as ResumeItem[];
}

// person, education, experience, projects, skills, programs, and interests
// all live under the same partition key (PK = "RESUME"), so one Query with
// no sort-key condition fetches all of them in a single DynamoDB round trip.
// Memoizing per request means the Resume operation's seven concurrently
// resolved root fields share that one call instead of each firing their own.
export function createResumePartitionLoader(): () => Promise<ResumeItem[]> {
  let cached: Promise<ResumeItem[]> | null = null;

  return () => (cached ??= queryResumePartition());
}
