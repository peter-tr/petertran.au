import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  LambdaClient,
  PutProvisionedConcurrencyConfigCommand,
  DeleteProvisionedConcurrencyConfigCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-lambda";
import { SSMClient, GetParameterCommand, PutParameterCommand } from "@aws-sdk/client-ssm";
import { SchedulerClient, GetScheduleCommand, UpdateScheduleCommand } from "@aws-sdk/client-scheduler";

// Read as module-level consts at import time in handler.ts. A static
// `import` is hoisted above these assignments regardless of where it's
// written textually (ES module semantics), so a dynamic import is used here
// instead to guarantee the env vars are set first.
process.env.LIVE_ALIAS_NAME = "live";
process.env.WARM_SCHEDULE_PARAM_NAME = "/warm-schedule/schedules";
process.env.PORTFOLIO_FN_NAME = "portfolio-fn";
process.env.PANTRY_FN_NAME = "pantry-fn";
process.env.IMPOSTER_FN_NAME = "imposter-fn";
process.env.SUPERGRAPH_FN_NAME = "supergraph-fn";
process.env.ZTL_IDP_BRIDGE_FN_NAME = "ztl-idp-bridge-fn";
process.env.ZTL_INTERNAL_STS_FN_NAME = "ztl-internal-sts-fn";
process.env.ZTL_EDGE_AUTHORIZER_FN_NAME = "ztl-edge-authorizer-fn";
process.env.ZTL_EDGE_PROXY_FN_NAME = "ztl-edge-proxy-fn";
process.env.ZTL_DOMAIN_A_FN_NAME = "ztl-domain-a-fn";
process.env.WARM_SCHEDULE_NAMES = JSON.stringify({
  portfolio: { on: "warm-on-portfolio", off: "warm-off-portfolio" },
  pantry: { on: "warm-on-pantry", off: "warm-off-pantry" },
  imposter: { on: "warm-on-imposter", off: "warm-off-imposter" },
  supergraph: { on: "warm-on-supergraph", off: "warm-off-supergraph" },
  zeroTrustLab: { on: "warm-on-zero-trust-lab", off: "warm-off-zero-trust-lab" },
});

const { handler } = await import("./handler");
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const lambdaMock = mockClient(LambdaClient);
const ssmMock = mockClient(SSMClient);
const schedulerMock = mockClient(SchedulerClient);

const ALL_ZTL_TARGETS = [
  "ztl-idp-bridge-fn",
  "ztl-internal-sts-fn",
  "ztl-edge-authorizer-fn",
  "ztl-edge-proxy-fn",
  "ztl-domain-a-fn",
];
const ALL_TARGETS = ["portfolio-fn", "pantry-fn", "imposter-fn", "supergraph-fn", ...ALL_ZTL_TARGETS];

const DEFAULT_SCHEDULE = {
  enabled: true,
  days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
  start: "08:00",
  end: "19:00",
  concurrency: 1,
};
const DEFAULT_CONFIG = {
  portfolio: DEFAULT_SCHEDULE,
  pantry: DEFAULT_SCHEDULE,
  imposter: DEFAULT_SCHEDULE,
  supergraph: DEFAULT_SCHEDULE,
  zeroTrustLab: DEFAULT_SCHEDULE,
};

// 2026-07-20T00:00:00Z = 10:00 Sydney (AEST, UTC+10 - July is outside the
// Oct-April daylight-saving window) - within the default 8am-7pm window.
const WITHIN_WINDOW = new Date("2026-07-20T00:00:00.000Z");
// Same calendar day, 22:00 Sydney - outside the window.
const OUTSIDE_WINDOW = new Date("2026-07-20T12:00:00.000Z");

function httpEvent(method: string, body?: unknown): APIGatewayProxyEventV2 {
  return {
    requestContext: { http: { method } },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

beforeEach(() => {
  lambdaMock.reset();
  ssmMock.reset();
  schedulerMock.reset();
  lambdaMock.on(PutProvisionedConcurrencyConfigCommand).resolves({});
  lambdaMock.on(DeleteProvisionedConcurrencyConfigCommand).resolves({});
  schedulerMock.on(GetScheduleCommand).resolves({
    FlexibleTimeWindow: { Mode: "OFF" },
    Target: {
      Arn: "arn:aws:lambda:ap-southeast-2:123456789012:function:warm-schedule",
      RoleArn: "arn:aws:iam::123456789012:role/warm-schedule-role",
    },
  });
  schedulerMock.on(UpdateScheduleCommand).resolves({});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("warm-schedule handler - config GET/POST", () => {
  it("GET with no stored parameter returns the all-enabled 8am-7pm defaults", async () => {
    ssmMock.on(GetParameterCommand).resolves({});

    const result = await handler(httpEvent("GET"));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body as string)).toEqual(DEFAULT_CONFIG);
  });

  it("GET merges a stored partial project over the defaults", async () => {
    ssmMock.on(GetParameterCommand).resolves({
      Parameter: { Value: JSON.stringify({ portfolio: { enabled: false } }) },
    });

    const result = await handler(httpEvent("GET"));
    expect(JSON.parse(result.body as string)).toEqual({
      ...DEFAULT_CONFIG,
      portfolio: { ...DEFAULT_SCHEDULE, enabled: false },
    });
  });

  it("POST with an invalid schedule returns 400", async () => {
    const result = await handler(
      httpEvent("POST", {
        project: "portfolio",
        schedule: { enabled: true, days: [], start: "08:00", end: "19:00", concurrency: 1 },
      })
    );
    expect(result.statusCode).toBe(400);
    expect(ssmMock.commandCalls(PutParameterCommand)).toHaveLength(0);
  });

  it("POST with start >= end returns 400", async () => {
    const result = await handler(
      httpEvent("POST", {
        project: "portfolio",
        schedule: { enabled: true, days: ["MON"], start: "19:00", end: "08:00", concurrency: 1 },
      })
    );
    expect(result.statusCode).toBe(400);
  });

  it.each([
    ["zero", 0],
    ["above the max", 6],
    ["non-integer", 1.5],
  ])("POST with concurrency %s returns 400", async (_label, concurrency) => {
    const result = await handler(
      httpEvent("POST", {
        project: "portfolio",
        schedule: { enabled: true, days: ["MON"], start: "08:00", end: "19:00", concurrency },
      })
    );
    expect(result.statusCode).toBe(400);
    expect(ssmMock.commandCalls(PutParameterCommand)).toHaveLength(0);
  });

  it("POST with an unrecognized project returns 400", async () => {
    const result = await handler(
      httpEvent("POST", { project: "not-a-real-project", schedule: DEFAULT_SCHEDULE })
    );
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string).error).toContain(
      "portfolio/pantry/imposter/supergraph/zeroTrustLab"
    );
  });

  it("POST persists the updated schedule, updates its on/off EventBridge Schedules, and reconciles immediately", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(WITHIN_WINDOW);
    ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: JSON.stringify(DEFAULT_CONFIG) } });

    const newSchedule = {
      enabled: true,
      days: ["MON", "TUE", "WED", "THU", "FRI"],
      start: "07:30",
      end: "18:00",
      concurrency: 3,
    };
    const result = await handler(httpEvent("POST", { project: "pantry", schedule: newSchedule }));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body as string)).toEqual({ ...DEFAULT_CONFIG, pantry: newSchedule });

    const putParamCalls = ssmMock.commandCalls(PutParameterCommand);
    expect(putParamCalls).toHaveLength(1);
    expect(JSON.parse(putParamCalls[0].args[0].input.Value as string).pantry).toEqual(newSchedule);

    const updateCalls = schedulerMock.commandCalls(UpdateScheduleCommand);
    expect(updateCalls.map((c) => c.args[0].input.Name).sort()).toEqual(
      ["warm-off-pantry", "warm-on-pantry"].sort()
    );

    const onCall = updateCalls.find((c) => c.args[0].input.Name === "warm-on-pantry")!;
    expect(onCall.args[0].input.ScheduleExpression).toBe("cron(30 07 ? * MON,TUE,WED,THU,FRI *)");
    expect(onCall.args[0].input.State).toBe("ENABLED");

    const offCall = updateCalls.find((c) => c.args[0].input.Name === "warm-off-pantry")!;
    expect(offCall.args[0].input.ScheduleExpression).toBe("cron(00 18 ? * MON,TUE,WED,THU,FRI *)");

    // Only pantry changed, so only pantry-fn should be reconciled - within
    // window and enabled, so it should be granted PC at its configured
    // (non-default) concurrency.
    const putCalls = lambdaMock.commandCalls(PutProvisionedConcurrencyConfigCommand);
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].args[0].input.FunctionName).toBe("pantry-fn");
    expect(putCalls[0].args[0].input.ProvisionedConcurrentExecutions).toBe(3);
  });

  it("POST with enabled:false disables both EventBridge Schedules and tears down warm capacity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(WITHIN_WINDOW);
    ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: JSON.stringify(DEFAULT_CONFIG) } });

    const disabled = { ...DEFAULT_SCHEDULE, enabled: false };
    await handler(httpEvent("POST", { project: "pantry", schedule: disabled }));

    const updateCalls = schedulerMock.commandCalls(UpdateScheduleCommand);
    expect(updateCalls.every((c) => c.args[0].input.State === "DISABLED")).toBe(true);

    const deleteCalls = lambdaMock.commandCalls(DeleteProvisionedConcurrencyConfigCommand);
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0].args[0].input.FunctionName).toBe("pantry-fn");
  });
});

describe("warm-schedule handler - on/off trigger", () => {
  it("grants PC to a project's targets on an 'on' trigger, at its configured (default) concurrency", async () => {
    ssmMock.on(GetParameterCommand).resolves({});

    const result = await handler({ project: "imposter", action: "on" });
    expect(result).toEqual({ statusCode: 200, body: "reconciled" });

    const putCalls = lambdaMock.commandCalls(PutProvisionedConcurrencyConfigCommand);
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].args[0].input.FunctionName).toBe("imposter-fn");
    expect(putCalls[0].args[0].input.ProvisionedConcurrentExecutions).toBe(1);
  });

  it("grants a non-default configured concurrency on an 'on' trigger", async () => {
    ssmMock.on(GetParameterCommand).resolves({
      Parameter: { Value: JSON.stringify({ imposter: { ...DEFAULT_SCHEDULE, concurrency: 4 } }) },
    });

    await handler({ project: "imposter", action: "on" });

    const putCalls = lambdaMock.commandCalls(PutProvisionedConcurrencyConfigCommand);
    expect(putCalls[0].args[0].input.ProvisionedConcurrentExecutions).toBe(4);
  });

  it("tears down PC for a project's targets on an 'off' trigger", async () => {
    ssmMock.on(GetParameterCommand).resolves({});

    const result = await handler({ project: "zeroTrustLab", action: "off" });
    expect(result).toEqual({ statusCode: 200, body: "reconciled" });

    const deleteCalls = lambdaMock.commandCalls(DeleteProvisionedConcurrencyConfigCommand);
    expect(deleteCalls.map((c) => c.args[0].input.FunctionName).sort()).toEqual([...ALL_ZTL_TARGETS].sort());
  });
});

describe("warm-schedule handler - reconcile ping", () => {
  it("grants PC to every target when every project is enabled and within its window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(WITHIN_WINDOW);
    ssmMock.on(GetParameterCommand).resolves({});

    const result = await handler({ reconcile: true });
    expect(result).toEqual({ statusCode: 200, body: "reconciled" });

    const putCalls = lambdaMock.commandCalls(PutProvisionedConcurrencyConfigCommand);
    expect(putCalls.map((c) => c.args[0].input.FunctionName).sort()).toEqual([...ALL_TARGETS].sort());
    for (const call of putCalls) {
      expect(call.args[0].input.Qualifier).toBe("live");
      expect(call.args[0].input.ProvisionedConcurrentExecutions).toBe(1);
    }
    expect(lambdaMock.commandCalls(DeleteProvisionedConcurrencyConfigCommand)).toHaveLength(0);
  });

  it("tears down PC on every target outside every project's window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(OUTSIDE_WINDOW);
    ssmMock.on(GetParameterCommand).resolves({});

    await handler({ reconcile: true });

    const deleteCalls = lambdaMock.commandCalls(DeleteProvisionedConcurrencyConfigCommand);
    expect(deleteCalls.map((c) => c.args[0].input.FunctionName).sort()).toEqual([...ALL_TARGETS].sort());
    expect(lambdaMock.commandCalls(PutProvisionedConcurrencyConfigCommand)).toHaveLength(0);
  });

  it("tears down just the disabled project's targets while granting PC to the rest within window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(WITHIN_WINDOW);
    ssmMock
      .on(GetParameterCommand)
      .resolves({ Parameter: { Value: JSON.stringify({ zeroTrustLab: { enabled: false } }) } });

    await handler({ reconcile: true });

    const deleteCalls = lambdaMock.commandCalls(DeleteProvisionedConcurrencyConfigCommand);
    expect(deleteCalls.map((c) => c.args[0].input.FunctionName).sort()).toEqual([...ALL_ZTL_TARGETS].sort());

    const putCalls = lambdaMock.commandCalls(PutProvisionedConcurrencyConfigCommand);
    expect(putCalls.map((c) => c.args[0].input.FunctionName).sort()).toEqual(
      ["portfolio-fn", "pantry-fn", "imposter-fn", "supergraph-fn"].sort()
    );
  });

  it("grants each project its own configured concurrency, not a shared default", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(WITHIN_WINDOW);
    ssmMock.on(GetParameterCommand).resolves({
      Parameter: { Value: JSON.stringify({ pantry: { ...DEFAULT_SCHEDULE, concurrency: 2 } }) },
    });

    await handler({ reconcile: true });

    const putCalls = lambdaMock.commandCalls(PutProvisionedConcurrencyConfigCommand);
    const pantryCall = putCalls.find((c) => c.args[0].input.FunctionName === "pantry-fn")!;
    const portfolioCall = putCalls.find((c) => c.args[0].input.FunctionName === "portfolio-fn")!;
    expect(pantryCall.args[0].input.ProvisionedConcurrentExecutions).toBe(2);
    expect(portfolioCall.args[0].input.ProvisionedConcurrentExecutions).toBe(1);
  });

  it("tears down a project outside its own narrower window even while others (default, wider) are within theirs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(WITHIN_WINDOW); // 10:00 Sydney
    ssmMock.on(GetParameterCommand).resolves({
      Parameter: {
        Value: JSON.stringify({ pantry: { enabled: true, days: ["MON"], start: "12:00", end: "13:00" } }),
      },
    });

    await handler({ reconcile: true });

    const deleteCalls = lambdaMock.commandCalls(DeleteProvisionedConcurrencyConfigCommand);
    expect(deleteCalls.map((c) => c.args[0].input.FunctionName)).toContain("pantry-fn");

    const putCalls = lambdaMock.commandCalls(PutProvisionedConcurrencyConfigCommand);
    expect(putCalls.map((c) => c.args[0].input.FunctionName)).not.toContain("pantry-fn");
  });

  it("treats a ResourceNotFoundException on teardown as already-in-the-desired-state, not a failure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(OUTSIDE_WINDOW);
    ssmMock.on(GetParameterCommand).resolves({});
    lambdaMock.on(DeleteProvisionedConcurrencyConfigCommand).rejects(
      new ResourceNotFoundException({
        message: "no provisioned concurrency config found",
        $metadata: {},
      })
    );

    const result = await handler({ reconcile: true });
    expect(result).toEqual({ statusCode: 200, body: "reconciled" });
  });

  it("logs but does not throw or block other targets when reconciling one target fails unexpectedly", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(WITHIN_WINDOW);
    ssmMock.on(GetParameterCommand).resolves({});

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    lambdaMock
      .on(PutProvisionedConcurrencyConfigCommand, { FunctionName: "portfolio-fn" })
      .rejects(new Error("concurrency quota exceeded"));

    const result = await handler({ reconcile: true });
    expect(result).toEqual({ statusCode: 200, body: "reconciled" });
    expect(consoleErrorSpy).toHaveBeenCalled();

    // The other targets still got reconciled despite portfolio-fn's failure.
    const putCalls = lambdaMock.commandCalls(PutProvisionedConcurrencyConfigCommand);
    const succeededTargets = putCalls
      .filter((c) => c.args[0].input.FunctionName !== "portfolio-fn")
      .map((c) => c.args[0].input.FunctionName);
    expect(succeededTargets.sort()).toEqual(
      ["pantry-fn", "imposter-fn", "supergraph-fn", ...ALL_ZTL_TARGETS].sort()
    );

    consoleErrorSpy.mockRestore();
  });
});
