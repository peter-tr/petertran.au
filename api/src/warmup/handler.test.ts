import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { SchedulerClient, GetScheduleCommand, UpdateScheduleCommand } from "@aws-sdk/client-scheduler";

// Read as a module-level const at import time in handler.ts. A static
// `import` is hoisted above this assignment regardless of where it's written
// textually (ES module semantics), so a dynamic import is used here instead
// to guarantee the env var is set first.
process.env.SCHEDULE_NAMES = "portfolio-warmup,pantry-warmup,imposter-warmup";

const { handler } = await import("./handler");
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const schedulerMock = mockClient(SchedulerClient);

function httpEvent(method: string, body?: unknown): APIGatewayProxyEventV2 {
  return {
    requestContext: { http: { method } },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

beforeEach(() => {
  schedulerMock.reset();
});

describe("warmup handler", () => {
  it("short-circuits a warmup ping without calling the Scheduler API", async () => {
    const result = await handler({ warmup: true });
    expect(result).toEqual({ statusCode: 200, body: "warm" });
    expect(schedulerMock.commandCalls(GetScheduleCommand)).toHaveLength(0);
  });

  it("GET reports enabled:true when the first schedule's state is ENABLED", async () => {
    schedulerMock.on(GetScheduleCommand, { Name: "portfolio-warmup" }).resolves({ State: "ENABLED" });

    const result = await handler(httpEvent("GET"));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body as string)).toEqual({ enabled: true });
  });

  it("GET reports enabled:false when the first schedule's state is DISABLED", async () => {
    schedulerMock.on(GetScheduleCommand, { Name: "portfolio-warmup" }).resolves({ State: "DISABLED" });

    const result = await handler(httpEvent("GET"));
    expect(JSON.parse(result.body as string)).toEqual({ enabled: false });
  });

  it("GET only reads the first schedule name to answer the enabled question", async () => {
    schedulerMock.on(GetScheduleCommand, { Name: "portfolio-warmup" }).resolves({ State: "ENABLED" });

    await handler(httpEvent("GET"));
    expect(schedulerMock.commandCalls(GetScheduleCommand)).toHaveLength(1);
  });

  it("POST with a non-boolean enabled value returns 400", async () => {
    const result = await handler(httpEvent("POST", { enabled: "yes" }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string)).toEqual({ error: "enabled must be a boolean" });
    expect(schedulerMock.commandCalls(UpdateScheduleCommand)).toHaveLength(0);
  });

  it("POST enabling re-fetches and re-sends every schedule's own definition with State: ENABLED", async () => {
    schedulerMock.on(GetScheduleCommand).callsFake((input: { Name: string }) => ({
      ScheduleExpression: `rate(${input.Name})`,
      FlexibleTimeWindow: { Mode: "OFF" },
      Target: { Arn: `arn:${input.Name}`, RoleArn: "arn:role" },
      State: "DISABLED",
    }));

    const result = await handler(httpEvent("POST", { enabled: true }));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body as string)).toEqual({ enabled: true });

    const updateCalls = schedulerMock.commandCalls(UpdateScheduleCommand);
    expect(updateCalls).toHaveLength(3);
    for (const call of updateCalls) {
      const input = call.args[0].input;
      expect(input.State).toBe("ENABLED");
      expect(input.ScheduleExpression).toBe(`rate(${input.Name})`);
      expect(input.Target).toEqual({ Arn: `arn:${input.Name}`, RoleArn: "arn:role" });
    }
    expect(updateCalls.map((c) => c.args[0].input.Name).sort()).toEqual(
      ["imposter-warmup", "pantry-warmup", "portfolio-warmup"].sort()
    );
  });

  it("POST disabling sends State: DISABLED for every schedule", async () => {
    schedulerMock.on(GetScheduleCommand).callsFake((input: { Name: string }) => ({
      ScheduleExpression: "rate(5 minutes)",
      FlexibleTimeWindow: { Mode: "OFF" },
      Target: { Arn: `arn:${input.Name}` },
      State: "ENABLED",
    }));

    await handler(httpEvent("POST", { enabled: false }));

    const updateCalls = schedulerMock.commandCalls(UpdateScheduleCommand);
    expect(updateCalls).toHaveLength(3);
    for (const call of updateCalls) {
      expect(call.args[0].input.State).toBe("DISABLED");
    }
  });
});
