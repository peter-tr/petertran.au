import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContactInput } from "../lib/util/contact";

vi.mock("../lib/aws/ddb", () => ({
  ddb: { send: vi.fn() },
  TABLE_NAME: "petertran-au-resume",
  PK: "RESUME",
}));

vi.mock("../lib/anthropic/generate-query", () => ({
  generateQuery: vi.fn(),
}));

vi.mock("../lib/aws/system-stats", () => ({
  getSystemStats: vi.fn(),
}));

vi.mock("../lib/aws/xray", () => ({
  getTraceBreakdown: vi.fn(),
}));

vi.mock("../lib/aws/aws-cost", () => ({
  getAwsAllTimeCostUsd: vi.fn(),
}));

vi.mock("../lib/anthropic/anthropic-cost", () => ({
  getAnthropicAllTimeCostUsd: vi.fn(),
}));

vi.mock("../lib/aws/email", () => ({
  sendContactNotification: vi.fn(),
}));

import { ddb, PK } from "../lib/aws/ddb";
import { generateQuery } from "../lib/anthropic/generate-query";
import { getSystemStats } from "../lib/aws/system-stats";
import { getTraceBreakdown } from "../lib/aws/xray";
import { getAwsAllTimeCostUsd } from "../lib/aws/aws-cost";
import { getAnthropicAllTimeCostUsd } from "../lib/anthropic/anthropic-cost";
import { sendContactNotification } from "../lib/aws/email";
import { resolvers } from "./resolvers";
import type { Context } from "../context";
import type { Education, Experience, Person, Program, Project, SkillCategory } from "../data";

type ResumeItem = { sk: string; type: string; data: unknown };

function makeContext(items: ResumeItem[], overrides: Partial<Context> = {}): Context {
  return {
    getResumePartition: vi.fn().mockResolvedValue(items),
    runInternalQuery: vi.fn(),
    sourceIp: undefined,
    userAgent: undefined,
    functionName: undefined,
    ...overrides,
  };
}

describe("portfolio resolvers", () => {
  beforeEach(() => {
    vi.mocked(ddb.send).mockReset().mockResolvedValue({});
    vi.mocked(generateQuery).mockReset();
    vi.mocked(getSystemStats).mockReset();
    vi.mocked(getTraceBreakdown).mockReset();
    vi.mocked(getAwsAllTimeCostUsd).mockReset();
    vi.mocked(getAnthropicAllTimeCostUsd).mockReset();
    vi.mocked(sendContactNotification).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Query.person", () => {
    it("returns the PERSON item's data", async () => {
      const person: Person = {
        name: "Ada",
        email: "a@b.com",
        location: "Sydney",
        clearance: "NV1",
        links: [],
      };
      const context = makeContext([{ sk: "PERSON", type: "PERSON", data: person }]);

      const result = await resolvers.Query.person({}, {}, context);
      expect(result).toEqual(person);
    });

    it("throws when no PERSON item exists", async () => {
      const context = makeContext([]);

      await expect(resolvers.Query.person({}, {}, context)).rejects.toThrow(
        "Person record not found - has the table been seeded?"
      );
    });
  });

  describe("Query.education / projects / programs", () => {
    it("passes through all items of the matching type", async () => {
      const education: Education = {
        institution: "UQ",
        degree: "BSE",
        location: "Brisbane",
        startDate: "2020-01",
        endDate: "2024-01",
        honors: "",
      };
      const context = makeContext([
        { sk: "EDU#1", type: "EDUCATION", data: education },
        { sk: "PROJ#1", type: "PROJECT", data: {} as Project },
      ]);

      const result = await resolvers.Query.education({}, {}, context);
      expect(result).toEqual([education]);
    });
  });

  describe("Query.experience", () => {
    const current: Experience = {
      company: "CBA",
      role: "Engineer",
      location: "Sydney",
      startDate: "2026-01",
      endDate: null,
      summary: null,
      highlights: [],
    };
    const past: Experience = {
      company: "Boeing",
      role: "Engineer",
      location: "Brisbane",
      startDate: "2020-01",
      endDate: "2021-01",
      summary: null,
      highlights: [],
    };

    function context() {
      return makeContext([
        { sk: "EXP#1", type: "EXPERIENCE", data: current },
        { sk: "EXP#2", type: "EXPERIENCE", data: past },
      ]);
    }

    it("returns all experience with no filters", async () => {
      const result = await resolvers.Query.experience({}, {}, context());
      expect(result).toHaveLength(2);
    });

    it("filters by company case-insensitively (substring match)", async () => {
      const result = await resolvers.Query.experience({}, { company: "boe" }, context());
      expect(result).toEqual([past]);
    });

    it("filters to current-only (endDate === null)", async () => {
      const result = await resolvers.Query.experience({}, { currentOnly: true }, context());
      expect(result).toEqual([current]);
    });

    it("combines company and currentOnly filters", async () => {
      const result = await resolvers.Query.experience({}, { company: "cba", currentOnly: true }, context());
      expect(result).toEqual([current]);
    });
  });

  describe("Query.skills", () => {
    it("filters by category case-insensitively (substring match)", async () => {
      const languages: SkillCategory = { category: "Languages", items: ["TypeScript"] };
      const infra: SkillCategory = { category: "Infrastructure & Tools", items: ["AWS"] };
      const context = makeContext([
        { sk: "SKILL#1", type: "SKILL", data: languages },
        { sk: "SKILL#2", type: "SKILL", data: infra },
      ]);

      const result = await resolvers.Query.skills({}, { category: "infra" }, context);
      expect(result).toEqual([infra]);
    });
  });

  describe("Query.programs", () => {
    it("passes through all PROGRAM items", async () => {
      const program: Program = {
        name: "ADF Cyber GAP",
        organization: "ADF",
        description: "",
        startDate: "2022-01",
        endDate: "2022-12",
      };
      const context = makeContext([{ sk: "PROGRAM#1", type: "PROGRAM", data: program }]);

      const result = await resolvers.Query.programs({}, {}, context);
      expect(result).toEqual([program]);
    });
  });

  describe("Query.interests", () => {
    it("returns the PERSONAL item's data", async () => {
      const interests = { hobbies: ["Bouldering"], favoriteFoods: [], favoriteShows: [] };
      const context = makeContext([{ sk: "PERSONAL", type: "PERSONAL", data: interests }]);

      const result = await resolvers.Query.interests({}, {}, context);
      expect(result).toEqual(interests);
    });

    it("throws when no PERSONAL item exists", async () => {
      const context = makeContext([]);

      await expect(resolvers.Query.interests({}, {}, context)).rejects.toThrow(
        "Interests record not found - has the table been seeded?"
      );
    });
  });

  describe("Query.meta", () => {
    it("returns an empty object as the Meta root", () => {
      expect(resolvers.Query.meta()).toEqual({});
    });
  });

  describe("Meta.generateQuery", () => {
    it("delegates to generateQuery with the context's sourceIp/runInternalQuery/xraySegment", async () => {
      vi.mocked(generateQuery).mockResolvedValue({ query: null, message: "hi", answer: null });

      const runInternalQuery = vi.fn();
      const context = makeContext([], { sourceIp: "1.2.3.4", runInternalQuery, xraySegment: undefined });

      await resolvers.Meta.generateQuery({}, { prompt: "hello" }, context);

      expect(generateQuery).toHaveBeenCalledWith("hello", "1.2.3.4", runInternalQuery, undefined);
    });
  });

  describe("Meta.systemStats", () => {
    it("delegates to getSystemStats with the context's functionName", async () => {
      vi.mocked(getSystemStats).mockResolvedValue({} as never);

      const context = makeContext([], { functionName: "my-fn" });

      await resolvers.Meta.systemStats({}, {}, context);

      expect(getSystemStats).toHaveBeenCalledWith("my-fn");
    });
  });

  describe("Meta.traceBreakdown", () => {
    it("delegates to getTraceBreakdown with the given traceId", async () => {
      vi.mocked(getTraceBreakdown).mockResolvedValue([]);

      await resolvers.Meta.traceBreakdown({}, { traceId: "trace-1" });

      expect(getTraceBreakdown).toHaveBeenCalledWith("trace-1");
    });
  });

  describe("Meta.awsCostUsd / anthropicCostUsd / totalCostUsd", () => {
    it("returns the raw AWS cost as-is", async () => {
      vi.mocked(getAwsAllTimeCostUsd).mockResolvedValue(12.34);

      const result = await resolvers.Meta.awsCostUsd();
      expect(result).toBe(12.34);
    });

    it("subtracts the $5 manual adjustment from the Anthropic cost", async () => {
      vi.mocked(getAnthropicAllTimeCostUsd).mockResolvedValue(10);

      const result = await resolvers.Meta.anthropicCostUsd();
      expect(result).toBe(5);
    });

    it("floors the adjusted Anthropic cost at 0 rather than going negative", async () => {
      vi.mocked(getAnthropicAllTimeCostUsd).mockResolvedValue(3);

      const result = await resolvers.Meta.anthropicCostUsd();
      expect(result).toBe(0);
    });

    it("sums AWS cost and the adjusted Anthropic cost for totalCostUsd", async () => {
      vi.mocked(getAwsAllTimeCostUsd).mockResolvedValue(2);
      vi.mocked(getAnthropicAllTimeCostUsd).mockResolvedValue(10);

      const result = await resolvers.Meta.totalCostUsd();
      expect(result).toBe(7); // 2 + max(0, 10 - 5)
    });
  });

  describe("Mutation.sendMessage", () => {
    const validInput: ContactInput = { name: "Ada", email: "ada@example.com", message: "Hi!" };

    it("rejects invalid input before ever touching DynamoDB", async () => {
      const context = makeContext([]);

      await expect(
        resolvers.Mutation.sendMessage({}, { input: { name: "", email: "", message: "" } }, context)
      ).rejects.toThrow("name, email, and message are all required.");

      expect(ddb.send).not.toHaveBeenCalled();
    });

    it("stores the message and returns a success confirmation", async () => {
      const context = makeContext([], { sourceIp: "1.2.3.4", userAgent: "TestAgent" });

      const result = await resolvers.Mutation.sendMessage({}, { input: validInput }, context);

      expect(result).toEqual({ success: true, message: "Thanks - you'll hear back from me soon." });
      expect(ddb.send).toHaveBeenCalledOnce();

      const putCommand = vi.mocked(ddb.send).mock.calls[0][0] as { input: Record<string, unknown> };
      expect(putCommand.input.TableName).toBe("petertran-au-resume");

      const item = putCommand.input.Item as { pk: string; sk: string; type: string; data: unknown };
      expect(item.pk).toBe(PK);
      expect(item.sk).toMatch(/^MESSAGE#/);
      expect(item.type).toBe("MESSAGE");
      expect(item.data).toMatchObject(validInput);
    });

    it("sends the contact notification email with the visitor's meta", async () => {
      const context = makeContext([], { sourceIp: "1.2.3.4", userAgent: "TestAgent" });

      await resolvers.Mutation.sendMessage({}, { input: validInput }, context);

      expect(sendContactNotification).toHaveBeenCalledWith(
        validInput,
        expect.objectContaining({ sourceIp: "1.2.3.4", userAgent: "TestAgent" })
      );
    });

    it("still returns success when the notification email fails to send", async () => {
      vi.mocked(sendContactNotification).mockRejectedValue(new Error("SES down"));

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const context = makeContext([]);

      const result = await resolvers.Mutation.sendMessage({}, { input: validInput }, context);

      expect(result).toEqual({ success: true, message: "Thanks - you'll hear back from me soon." });
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Contact notification email failed to send:",
        expect.any(Error)
      );
    });
  });

  describe("Experience.isCurrent", () => {
    it("is true when endDate is null", () => {
      expect(resolvers.Experience.isCurrent({ endDate: null } as Experience)).toBe(true);
    });

    it("is false when endDate is set", () => {
      expect(resolvers.Experience.isCurrent({ endDate: "2021-01" } as Experience)).toBe(false);
    });
  });
});
