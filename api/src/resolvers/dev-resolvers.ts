import { generateQuery } from "../lib/generate-query";
import { validateContactInput, CONTACT_CONFIRMATION_MESSAGE, type ContactInput } from "../lib/contact";
import {
  person,
  personal,
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
const MOCK_HOURLY_COUNTS = [0, 1, 0, 0, 2, 0, 1, 3, 0, 0, 1, 0, 5, 2, 0, 1, 0, 0, 3, 8, 4, 1, 0, 2];

function mockRequestsByHour() {
  const now = Date.now();
  return MOCK_HOURLY_COUNTS.map((count, i) => ({
    timestamp: new Date(now - (MOCK_HOURLY_COUNTS.length - 1 - i) * 60 * 60 * 1000).toISOString(),
    count,
  }));
}

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
    personal: () => personal,
    meta: () => ({}),
  },
  Meta: {
    generateQuery: (_: unknown, args: { prompt: string }) => generateQuery(args.prompt),
    systemStats: () => ({
      requestsLast24h: 128,
      avgDurationMs: 42.5,
      errorsLast24h: 0,
      aiQueriesTotal: 17,
      operations: [
        { name: "Resume", count: 54, avgDurationMs: 61.2 },
        { name: "Hero", count: 41, avgDurationMs: 38.9 },
        { name: "GenerateQuery", count: 17, avgDurationMs: 940.4 },
        { name: "SystemStats", count: 9, avgDurationMs: 210.6 },
        { name: "SendMessage", count: 3, avgDurationMs: 55.0 },
      ],
      operationsLast3Days: [
        { name: "Resume", count: 12, avgDurationMs: 58.4 },
        { name: "Hero", count: 9, avgDurationMs: 36.1 },
        { name: "GenerateQuery", count: 4, avgDurationMs: 902.7 },
        { name: "SystemStats", count: 3, avgDurationMs: 198.2 },
      ],
      requestsByHour: mockRequestsByHour(),
    }),
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
