import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME, PK } from "../lib/ddb";
import { person, personal, education, experience, projects, skills, programs } from "../data";

type Row = { sk: string; type: string; data: unknown };

function rows(): Row[] {
  const out: Row[] = [
    { sk: "PERSON", type: "PERSON", data: person },
    { sk: "PERSONAL", type: "PERSONAL", data: personal },
  ];
  education.forEach((e, i) => out.push({ sk: `EDUCATION#${i}`, type: "EDUCATION", data: e }));
  experience.forEach((e, i) => out.push({ sk: `EXPERIENCE#${i}`, type: "EXPERIENCE", data: e }));
  projects.forEach((p, i) => out.push({ sk: `PROJECT#${i}`, type: "PROJECT", data: p }));
  skills.forEach((s, i) => out.push({ sk: `SKILL#${i}`, type: "SKILL", data: s }));
  programs.forEach((p, i) => out.push({ sk: `PROGRAM#${i}`, type: "PROGRAM", data: p }));
  return out;
}

async function main() {
  const items = rows();
  console.log(`Seeding ${items.length} items into table "${TABLE_NAME}"...`);

  const chunks: Row[][] = [];
  for (let i = 0; i < items.length; i += 25) chunks.push(items.slice(i, i + 25));

  for (const chunk of chunks) {
    await ddb.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: chunk.map((row) => ({
            PutRequest: { Item: { pk: PK, sk: row.sk, type: row.type, data: row.data } },
          })),
        },
      })
    );
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
