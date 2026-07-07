import { randomUUID } from "node:crypto";
import { QueryCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME, PK } from "../lib/ddb";
import { generateQuery } from "../lib/generate-query";
import { getSystemStats } from "../lib/system-stats";
import { getTraceBreakdown } from "../lib/xray";
import { validateContactInput, CONTACT_CONFIRMATION_MESSAGE, type ContactInput } from "../lib/contact";
import { sendContactNotification } from "../lib/email";
import type { Context } from "../context";
import type { Education, Experience, Interests, Person, Program, Project, SkillCategory } from "../data";

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
      if (!res.Item) throw new Error("Person record not found - has the table been seeded?");
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
    interests: async (): Promise<Interests> => {
      const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: PK, sk: "PERSONAL" } }));
      if (!res.Item) throw new Error("Interests record not found - has the table been seeded?");
      return res.Item.data as Interests;
    },
    meta: () => ({}),
  },
  Meta: {
    generateQuery: (_: unknown, args: { prompt: string }, context: Context) =>
      generateQuery(args.prompt, context.sourceIp),
    systemStats: (_: unknown, __: unknown, context: Context) => getSystemStats(context.functionName),
    traceBreakdown: (_: unknown, args: { traceId: string }) => getTraceBreakdown(args.traceId),
  },
  Mutation: {
    sendMessage: async (_: unknown, args: { input: ContactInput }, context: Context) => {
      validateContactInput(args.input);
      const { name, email, message } = args.input;
      const receivedAt = new Date().toISOString();

      await ddb.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            pk: PK,
            sk: `MESSAGE#${receivedAt}#${randomUUID()}`,
            type: "MESSAGE",
            data: { name, email, message, receivedAt },
          },
        })
      );

      try {
        await sendContactNotification(args.input, {
          receivedAt,
          sourceIp: context.sourceIp,
          userAgent: context.userAgent,
        });
      } catch (err) {
        // The message is already safely stored above - never fail the
        // mutation just because the email notification didn't go out. Still
        // log it, though, so a real delivery failure is actually visible.
        console.error("Contact notification email failed to send:", err);
      }

      return { success: true, message: CONTACT_CONFIRMATION_MESSAGE };
    },
  },
  Experience: {
    isCurrent: (parent: Experience) => parent.endDate === null,
  },
};
