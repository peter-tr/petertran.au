import { generateQuery } from "../lib/anthropic/generate-query";
import { validateContactInput, CONTACT_CONFIRMATION_MESSAGE, type ContactInput } from "../lib/util/contact";
import {
  person,
  interests,
  education,
  experience,
  projects,
  skills,
  programs,
  type Experience,
} from "../data";

// Deliberately sparse/spiky, matching what a low-traffic personal site's real
// CloudWatch numbers actually look like -- useful for testing the chart's
// axis scaling against a realistic worst case.
const MOCK_DAILY_COUNTS = [
  0, 2, 1, 0, 3, 0, 0, 1, 4, 0, 2, 0, 0, 1, 6, 3, 0, 0, 2, 1, 0, 5, 2, 0, 1, 0, 3, 8, 4, 1,
];

function mockRequestsByDay() {
  const now = Date.now();
  return MOCK_DAILY_COUNTS.map((count, i) => ({
    timestamp: new Date(now - (MOCK_DAILY_COUNTS.length - 1 - i) * 24 * 60 * 60 * 1000).toISOString(),
    count,
  }));
}

// Fake but representative -- there's no real X-Ray daemon locally, so this
// is what a GenerateQuery invocation's trace looks like in production: most
// of the time is the Anthropic call, with DynamoDB in single-digit ms.
const MOCK_TRACE_BREAKDOWN = [
  { name: "Lambda", startOffsetMs: 0, durationMs: 940 },
  { name: "DynamoDB (rate limit)", startOffsetMs: 4, durationMs: 11 },
  { name: "Anthropic API", startOffsetMs: 18, durationMs: 902 },
  { name: "DynamoDB (usage counter)", startOffsetMs: 922, durationMs: 9 },
];

// Mock resolvers used only by dev/server.ts -- static data, no DynamoDB,
// CloudWatch, or Anthropic calls (generateQuery is real; everything else is
// hardcoded) so the frontend can be developed without live AWS credentials.
export const devResolvers = {
  Query: {
    person: () => person,
    education: () => education,
    experience: (_: unknown, args: { company?: string; currentOnly?: boolean }) => {
      let items = experience;
      if (args.company) {
        const needle = args.company.toLowerCase();
        items = items.filter((e) => e.company.toLowerCase().includes(needle));
      }
      if (args.currentOnly) items = items.filter((e) => e.endDate === null);
      return items;
    },
    projects: () => projects,
    skills: (_: unknown, args: { category?: string }) => {
      let items = skills;
      if (args.category) {
        const needle = args.category.toLowerCase();
        items = items.filter((s) => s.category.toLowerCase().includes(needle));
      }
      return items;
    },
    programs: () => programs,
    interests: () => interests,
    meta: () => ({}),
  },
  Meta: {
    generateQuery: (_: unknown, args: { prompt: string }) => generateQuery(args.prompt),
    systemStats: () => ({
      requestsTotal: 128,
      avgDurationMs: 42.5,
      aiQueriesTotal: 17,
      uniqueVisitorsTotal: 42,
      operations: [
        {
          name: "Resume",
          count: 54,
          avgDurationMs: 61.2,
          lastQuery: "query Resume {\n  person { name }\n  experience { role company }\n}",
          lastVariables: null,
          lastTraceId: "mock-trace-resume",
        },
        {
          name: "Hero",
          count: 41,
          avgDurationMs: 38.9,
          lastQuery: "query Hero {\n  person { name }\n  experience { role company isCurrent }\n}",
          lastVariables: null,
          lastTraceId: "mock-trace-hero",
        },
        {
          name: "GenerateQuery",
          count: 17,
          avgDurationMs: 940.4,
          lastQuery:
            "query GenerateQuery($prompt: String!) {\n  meta { generateQuery(prompt: $prompt) { query message } }\n}",
          lastVariables: JSON.stringify({ prompt: "tell me something fun about peter" }),
          lastTraceId: "mock-trace-generatequery",
        },
        {
          name: "SystemStats",
          count: 9,
          avgDurationMs: 210.6,
          lastQuery: "query SystemStats {\n  meta { systemStats { requestsTotal } }\n}",
          lastVariables: null,
          lastTraceId: "mock-trace-systemstats",
        },
        {
          name: "SendMessage",
          count: 3,
          avgDurationMs: 55.0,
          lastQuery: null,
          lastVariables: null,
          lastTraceId: null,
        },
      ],
      operationsLast30Days: [
        {
          name: "Resume",
          count: 12,
          avgDurationMs: 58.4,
          lastQuery: "query Resume {\n  person { name }\n  experience { role company }\n}",
          lastVariables: null,
          lastTraceId: "mock-trace-resume",
        },
        {
          name: "Hero",
          count: 9,
          avgDurationMs: 36.1,
          lastQuery: "query Hero {\n  person { name }\n  experience { role company isCurrent }\n}",
          lastVariables: null,
          lastTraceId: "mock-trace-hero",
        },
        {
          name: "GenerateQuery",
          count: 4,
          avgDurationMs: 902.7,
          lastQuery:
            "query GenerateQuery($prompt: String!) {\n  meta { generateQuery(prompt: $prompt) { query message } }\n}",
          lastVariables: JSON.stringify({ prompt: "tell me something fun about peter" }),
          lastTraceId: "mock-trace-generatequery",
        },
        {
          name: "SystemStats",
          count: 3,
          avgDurationMs: 198.2,
          lastQuery: "query SystemStats {\n  meta { systemStats { requestsTotal } }\n}",
          lastVariables: null,
          lastTraceId: "mock-trace-systemstats",
        },
      ],
      requestsByDay: mockRequestsByDay(),
    }),
    traceBreakdown: () => MOCK_TRACE_BREAKDOWN,
    awsCostUsd: () => 0.0027,
    anthropicCostUsd: () => 0.0927,
    totalCostUsd: () => 0.0954,
  },
  Mutation: {
    sendMessage: (_: unknown, args: { input: ContactInput }) => {
      validateContactInput(args.input);
      console.log("Mock sendMessage received:", args.input);
      return { success: true, message: CONTACT_CONFIRMATION_MESSAGE };
    },
  },
  Experience: {
    isCurrent: (parent: Experience) => parent.endDate === null,
  },
};
