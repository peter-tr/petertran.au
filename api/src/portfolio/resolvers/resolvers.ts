import { randomUUID } from "node:crypto";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME, PK } from "../lib/aws/ddb";
import { generateQuery } from "../lib/anthropic/generate-query";
import { getSystemStats } from "../lib/aws/system-stats";
import { getTraceBreakdown } from "../lib/aws/xray";
import { getAwsAllTimeCostUsd } from "../lib/aws/aws-cost";
import { getAnthropicAllTimeCostUsd } from "../lib/anthropic/anthropic-cost";
import { validateContactInput, CONTACT_CONFIRMATION_MESSAGE, type ContactInput } from "../lib/util/contact";
import { sendContactNotification } from "../lib/aws/email";
import type { Context } from "../context";
import type { Education, Experience, Interests, Person, Program, Project, SkillCategory } from "../data";

async function itemsOfType<T>(context: Context, type: string): Promise<T[]> {
  const items = await context.getResumePartition();
  return items.filter((item) => item.type === type).map((item) => item.data as T);
}

// Manual $5 downward adjustment to the displayed Anthropic figure only -
// applied here rather than in anthropic-cost.ts so the cached raw amount
// stays the true value from Anthropic's cost report.
const ANTHROPIC_COST_ADJUSTMENT_USD = 5;

async function getAdjustedAnthropicCostUsd(): Promise<number> {
  const raw = await getAnthropicAllTimeCostUsd();
  return Math.max(0, raw - ANTHROPIC_COST_ADJUSTMENT_USD);
}

export const resolvers = {
  Query: {
    person: async (_: unknown, __: unknown, context: Context): Promise<Person> => {
      const items = await context.getResumePartition();
      const item = items.find((i) => i.type === "PERSON");
      if (!item) throw new Error("Person record not found - has the table been seeded?");
      return item.data as Person;
    },
    education: (_: unknown, __: unknown, context: Context) => itemsOfType<Education>(context, "EDUCATION"),
    experience: async (_: unknown, args: { company?: string; currentOnly?: boolean }, context: Context) => {
      let items = await itemsOfType<Experience>(context, "EXPERIENCE");
      if (args.company) {
        const needle = args.company.toLowerCase();
        items = items.filter((e) => e.company.toLowerCase().includes(needle));
      }
      if (args.currentOnly) {
        items = items.filter((e) => e.endDate === null);
      }
      return items;
    },
    projects: (_: unknown, __: unknown, context: Context) => itemsOfType<Project>(context, "PROJECT"),
    skills: async (_: unknown, args: { category?: string }, context: Context) => {
      let items = await itemsOfType<SkillCategory>(context, "SKILL");
      if (args.category) {
        const needle = args.category.toLowerCase();
        items = items.filter((s) => s.category.toLowerCase().includes(needle));
      }
      return items;
    },
    programs: (_: unknown, __: unknown, context: Context) => itemsOfType<Program>(context, "PROGRAM"),
    interests: async (_: unknown, __: unknown, context: Context): Promise<Interests> => {
      const items = await context.getResumePartition();
      const item = items.find((i) => i.type === "PERSONAL");
      if (!item) throw new Error("Interests record not found - has the table been seeded?");
      return item.data as Interests;
    },
    meta: () => ({}),
  },
  Meta: {
    generateQuery: (_: unknown, args: { prompt: string }, context: Context) =>
      generateQuery(args.prompt, context.sourceIp, context.runInternalQuery),
    systemStats: (_: unknown, __: unknown, context: Context) => getSystemStats(context.functionName),
    traceBreakdown: (_: unknown, args: { traceId: string }) => getTraceBreakdown(args.traceId),
    awsCostUsd: () => getAwsAllTimeCostUsd(),
    anthropicCostUsd: () => getAdjustedAnthropicCostUsd(),
    totalCostUsd: async () => {
      const [aws, anthropic] = await Promise.all([getAwsAllTimeCostUsd(), getAdjustedAnthropicCostUsd()]);
      return aws + anthropic;
    },
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
