import { randomUUID } from "node:crypto";
import { QueryCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME, PK } from "./ddb.js";
import { generateQuery } from "./generate-query.js";
import { validateContactInput, CONTACT_CONFIRMATION_MESSAGE, type ContactInput } from "./contact.js";
import type { Context } from "./context.js";
import type { Education, Experience, Person, Program, Project, SkillCategory } from "./data.js";

async function queryPrefix<T>(prefix: string): Promise<T[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":pk": PK, ":prefix": prefix },
    })
  );
  return (res.Items ?? []).map((item) => item.data as T);
}

export const resolvers = {
  Query: {
    person: async (): Promise<Person> => {
      const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: PK, sk: "PERSON" } }));
      if (!res.Item) throw new Error("Person record not found -- has the table been seeded?");
      return res.Item.data as Person;
    },
    education: () => queryPrefix<Education>("EDUCATION#"),
    experience: async (_: unknown, args: { company?: string; currentOnly?: boolean }) => {
      let items = await queryPrefix<Experience>("EXPERIENCE#");
      if (args.company) {
        const needle = args.company.toLowerCase();
        items = items.filter((e) => e.company.toLowerCase().includes(needle));
      }
      if (args.currentOnly) {
        items = items.filter((e) => e.endDate === null);
      }
      return items;
    },
    projects: () => queryPrefix<Project>("PROJECT#"),
    skills: async (_: unknown, args: { category?: string }) => {
      let items = await queryPrefix<SkillCategory>("SKILL#");
      if (args.category) {
        const needle = args.category.toLowerCase();
        items = items.filter((s) => s.category.toLowerCase().includes(needle));
      }
      return items;
    },
    programs: () => queryPrefix<Program>("PROGRAM#"),
    generateQuery: (_: unknown, args: { prompt: string }, context: Context) =>
      generateQuery(args.prompt, context.sourceIp),
  },
  Mutation: {
    sendMessage: async (_: unknown, args: { input: ContactInput }) => {
      validateContactInput(args.input);
      const { name, email, message } = args.input;

      await ddb.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            pk: PK,
            sk: `MESSAGE#${new Date().toISOString()}#${randomUUID()}`,
            type: "MESSAGE",
            data: { name, email, message, receivedAt: new Date().toISOString() },
          },
        })
      );

      return { success: true, message: CONTACT_CONFIRMATION_MESSAGE };
    },
  },
  Experience: {
    isCurrent: (parent: Experience) => parent.endDate === null,
  },
};
