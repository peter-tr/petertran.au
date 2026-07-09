import { BatchWriteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME, PK } from "../lib/aws/ddb";
import { person, interests, education, experience, projects, skills, programs } from "../data";

type Row = { sk: string; type: string; data: unknown };

function rows(): Row[] {
  const out: Row[] = [
    { sk: "PERSON", type: "PERSON", data: person },
    { sk: "PERSONAL", type: "PERSONAL", data: interests },
  ];
  education.forEach((e, i) => out.push({ sk: `EDUCATION#${i}`, type: "EDUCATION", data: e }));
  experience.forEach((e, i) => out.push({ sk: `EXPERIENCE#${i}`, type: "EXPERIENCE", data: e }));
  projects.forEach((p, i) => out.push({ sk: `PROJECT#${i}`, type: "PROJECT", data: p }));
  skills.forEach((s, i) => out.push({ sk: `SKILL#${i}`, type: "SKILL", data: s }));
  programs.forEach((p, i) => out.push({ sk: `PROGRAM#${i}`, type: "PROGRAM", data: p }));
  return out;
}

async function batchWrite(requests: Record<string, unknown>[]): Promise<void> {
  for (let i = 0; i < requests.length; i += 25) {
    const chunk = requests.slice(i, i + 25);
    await ddb.send(new BatchWriteCommand({ RequestItems: { [TABLE_NAME]: chunk } }));
  }
}

// Only these index-numbered prefixes are owned by this script - MESSAGE#
// (contact-form submissions) and anything else under this pk is unrelated
// data this script must never touch, let alone delete.
const MANAGED_PREFIXES = ["EDUCATION#", "EXPERIENCE#", "PROJECT#", "SKILL#", "PROGRAM#"];

async function main() {
  const items = rows();
  const freshKeys = new Set(items.map((row) => row.sk));

  // Index-numbered rows (EDUCATION#0, PROJECT#1, etc.) are overwritten in
  // place by sk, but if an array shrinks the old tail entries (e.g.
  // PROJECT#2, PROJECT#3 after removing two projects) are never touched by
  // the writes below - find and remove anything under this pk, WITHIN THE
  // PREFIXES THIS SCRIPT OWNS, that the current data no longer produces.
  const existing = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": PK },
    })
  );
  const staleKeys = (existing.Items ?? [])
    .map((item) => item.sk as string)
    .filter((sk) => MANAGED_PREFIXES.some((prefix) => sk.startsWith(prefix)) && !freshKeys.has(sk));

  if (staleKeys.length > 0) {
    console.log(`Removing ${staleKeys.length} stale item(s): ${staleKeys.join(", ")}`);
    await batchWrite(staleKeys.map((sk) => ({ DeleteRequest: { Key: { pk: PK, sk } } })));
  }

  console.log(`Seeding ${items.length} items into table "${TABLE_NAME}"...`);
  await batchWrite(
    items.map((row) => ({ PutRequest: { Item: { pk: PK, sk: row.sk, type: row.type, data: row.data } } }))
  );

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
