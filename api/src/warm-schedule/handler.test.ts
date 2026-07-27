import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  LambdaClient,
  PutProvisionedConcurrencyConfigCommand,
  DeleteProvisionedConcurrencyConfigCommand,
  GetAliasCommand,
  GetFunctionConfigurationCommand,
  GetProvisionedConcurrencyConfigCommand,
  UpdateFunctionConfigurationCommand,
  PublishVersionCommand,
  UpdateAliasCommand,
  ResourceNotFoundException,
  ProvisionedConcurrencyConfigNotFoundException,
} from "@aws-sdk/client-lambda";
import { SSMClient, GetParameterCommand, PutParameterCommand } from "@aws-sdk/client-ssm";
import { SchedulerClient, GetScheduleCommand, UpdateScheduleCommand } from "@aws-sdk/client-scheduler";

// Read as module-level consts at import time in handler.ts. A static
// `import` is hoisted above these assignments regardless of where it's
// written textually (ES module semantics), so a dynamic import is used here
// instead to guarantee the env vars are set first.
process.env.LIVE_ALIAS_NAME = "live";
process.env.WARM_SCHEDULE_PARAM_NAME = "/warm-schedule/schedules";
process.env.WARM_SCHEDULE_PROFILES_PARAM_NAME = "/warm-schedule/profiles";
process.env.WARM_SCHEDULE_REACTIVE_STATE_PARAM_NAME = "/warm-schedule/reactive-state";
process.env.PORTFOLIO_FN_NAME = "portfolio-fn";
process.env.PANTRY_FN_NAME = "pantry-fn";
process.env.IMPOSTER_FN_NAME = "imposter-fn";
process.env.SUPERGRAPH_FN_NAME = "supergraph-fn";
process.env.DESIGN_STUDIO_FN_NAME = "design-studio-fn";
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
  designStudio: { on: "warm-on-design-studio", off: "warm-off-design-studio" },
  zeroTrustLab: { on: "warm-on-zero-trust-lab", off: "warm-off-zero-trust-lab" },
});

const { handler } = await import("./handler");
import type { APIGatewayProxyEvent } from "aws-lambda";
import { gzipSync } from "node:zlib";

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
const ALL_TARGETS = [
  "portfolio-fn",
  "pantry-fn",
  "imposter-fn",
  "supergraph-fn",
  "design-studio-fn",
  ...ALL_ZTL_TARGETS,
];

const DEFAULT_SCHEDULE = {
  enabled: true,
  days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
  start: "08:00",
  end: "19:00",
  concurrency: 1,
  memoryMb: 512,
  reactiveEnabled: false,
};
const DEFAULT_CONFIG = {
  portfolio: DEFAULT_SCHEDULE,
  pantry: DEFAULT_SCHEDULE,
  imposter: DEFAULT_SCHEDULE,
  supergraph: DEFAULT_SCHEDULE,
  designStudio: DEFAULT_SCHEDULE,
  zeroTrustLab: DEFAULT_SCHEDULE,
};

// 2026-07-20T00:00:00Z = 10:00 Sydney (AEST, UTC+10 - July is outside the
// Oct-April daylight-saving window) - within the default 8am-7pm window.
const WITHIN_WINDOW = new Date("2026-07-20T00:00:00.000Z");
// Same calendar day, 22:00 Sydney - outside the window.
const OUTSIDE_WINDOW = new Date("2026-07-20T12:00:00.000Z");

function httpEvent(method: string, body?: unknown): APIGatewayProxyEvent {
  return {
    httpMethod: method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEvent;
}

// Mirrors the real envelope CloudWatch Logs sends a subscription filter's
// Lambda destination (gzip+base64 JSON) - see infra/lib/warm-schedule-stack.ts's
// SubscriptionFilter and handler.ts's isColdStartLogEvent/handleColdHit.
function coldStartLogEvent(functionName: string): { awslogs: { data: string } } {
  const payload = JSON.stringify({ logGroup: `/aws/lambda/${functionName}` });

  return { awslogs: { data: gzipSync(Buffer.from(payload, "utf-8")).toString("base64") } };
}

beforeEach(() => {
  lambdaMock.reset();
  ssmMock.reset();
  schedulerMock.reset();
  lambdaMock.on(PutProvisionedConcurrencyConfigCommand).resolves({});
  lambdaMock.on(DeleteProvisionedConcurrencyConfigCommand).resolves({});
  // Cost lookups (and reconcileMemory's live-memory check) the GET/POST/
  // reconcile branches now do for every target - default to "256MB, no PC
  // currently allocated" unless a test overrides it. Deliberately different
  // from DEFAULT_SCHEDULE's memoryMb (512), so every existing reconcile
  // test also exercises reconcileMemory's update/publish/move-alias path as
  // a side effect, same as it would against a freshly-deployed real Lambda
  // still sitting at its old memory.
  lambdaMock
    .on(GetFunctionConfigurationCommand)
    .resolves({ MemorySize: 256, LastUpdateStatus: "Successful" });
  lambdaMock.on(UpdateFunctionConfigurationCommand).resolves({});
  lambdaMock.on(PublishVersionCommand).resolves({ Version: "5" });
  lambdaMock.on(UpdateAliasCommand).resolves({});
  // No weighted RoutingConfig unless a test overrides it - see the
  // "weighted-alias self-heal" describe block below for the stuck-alias case.
  lambdaMock.on(GetAliasCommand).resolves({ FunctionVersion: "1" });
  // Real AWS behavior when a target currently has no PC config (e.g.
  // outside the warm window): GetProvisionedConcurrencyConfig rejects with
  // ProvisionedConcurrencyConfigNotFoundException, not ResourceNotFoundException.
  lambdaMock.on(GetProvisionedConcurrencyConfigCommand).rejects(
    new ProvisionedConcurrencyConfigNotFoundException({
      message: "The specified configuration does not exist.",
      $metadata: {},
    })
  );
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
    expect(JSON.parse(result.body as string).schedules).toEqual(DEFAULT_CONFIG);
  });

  it("GET merges a stored partial project over the defaults", async () => {
    ssmMock.on(GetParameterCommand).resolves({
      Parameter: { Value: JSON.stringify({ portfolio: { enabled: false } }) },
    });

    const result = await handler(httpEvent("GET"));
    expect(JSON.parse(result.body as string).schedules).toEqual({
      ...DEFAULT_CONFIG,
      portfolio: { ...DEFAULT_SCHEDULE, enabled: false },
    });
  });

  it("GET includes a real-price cost per project, from real memory size and live PC state", async () => {
    ssmMock.on(GetParameterCommand).resolves({});
    lambdaMock
      .on(GetProvisionedConcurrencyConfigCommand, { FunctionName: "pantry-fn" })
      .resolves({ AllocatedProvisionedConcurrentExecutions: 1, Status: "READY" });

    const result = await handler(httpEvent("GET"));
    const { costs } = JSON.parse(result.body as string);

    // pantry-fn: live memory 256MB (from the beforeEach mock), 1 live unit,
    // PC rate $0.000005236/GB-s.
    expect(costs.pantry.liveConcurrency).toBe(1);
    expect(costs.pantry.liveHourlyCostUsd).toBeCloseTo(0.25 * 1 * 0.000005236 * 3600, 10);
    // Scheduled cost uses the schedule's own memoryMb (512MB -> 0.5 factor),
    // not the live-queried 256MB - it projects what the configured schedule
    // will cost once reconciled, not what's costing right now. Default
    // schedule (8am-7pm every day, concurrency 1) -> 11h * 7 days/week.
    expect(costs.pantry.scheduledMonthlyCostUsd).toBeCloseTo(
      0.5 * 1 * 0.000005236 * 3600 * 77 * (365.25 / 7 / 12),
      6
    );

    // portfolio-fn never got PC granted in this test - currently costing $0.
    expect(costs.portfolio.liveConcurrency).toBe(0);
    expect(costs.portfolio.liveHourlyCostUsd).toBe(0);

    // zeroTrustLab sums cost across its 5 targets, all defaulting to 256MB here.
    expect(costs.zeroTrustLab.liveConcurrency).toBe(0);
  });

  it("POST with an invalid schedule returns 400", async () => {
    const result = await handler(
      httpEvent("POST", {
        schedules: {
          portfolio: { enabled: true, days: [], start: "08:00", end: "19:00", concurrency: 1 },
        },
      })
    );
    expect(result.statusCode).toBe(400);
    expect(ssmMock.commandCalls(PutParameterCommand)).toHaveLength(0);
  });

  it("POST with start >= end returns 400", async () => {
    const result = await handler(
      httpEvent("POST", {
        schedules: {
          portfolio: { enabled: true, days: ["MON"], start: "19:00", end: "08:00", concurrency: 1 },
        },
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
        schedules: {
          portfolio: { enabled: true, days: ["MON"], start: "08:00", end: "19:00", concurrency },
        },
      })
    );
    expect(result.statusCode).toBe(400);
    expect(ssmMock.commandCalls(PutParameterCommand)).toHaveLength(0);
  });

  it("POST with an unrecognized project returns 400", async () => {
    const result = await handler(
      httpEvent("POST", { schedules: { "not-a-real-project": DEFAULT_SCHEDULE } })
    );
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string).error).toContain(
      "portfolio/pantry/imposter/supergraph/designStudio/zeroTrustLab"
    );
  });

  it("POST with an empty schedules object returns 400", async () => {
    const result = await handler(httpEvent("POST", { schedules: {} }));
    expect(result.statusCode).toBe(400);
    expect(ssmMock.commandCalls(PutParameterCommand)).toHaveLength(0);
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
      memoryMb: 1024,
      reactiveEnabled: false,
    };
    const result = await handler(httpEvent("POST", { schedules: { pantry: newSchedule } }));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body as string).schedules).toEqual({ ...DEFAULT_CONFIG, pantry: newSchedule });

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
    await handler(httpEvent("POST", { schedules: { pantry: disabled } }));

    const updateCalls = schedulerMock.commandCalls(UpdateScheduleCommand);
    expect(updateCalls.every((c) => c.args[0].input.State === "DISABLED")).toBe(true);

    const deleteCalls = lambdaMock.commandCalls(DeleteProvisionedConcurrencyConfigCommand);
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0].args[0].input.FunctionName).toBe("pantry-fn");
  });

  it("POST with multiple dirty projects in one request persists all of them, not just the last", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(WITHIN_WINDOW);
    ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: JSON.stringify(DEFAULT_CONFIG) } });

    const newPantry = { ...DEFAULT_SCHEDULE, concurrency: 3, memoryMb: 1024 };
    const newImposter = { ...DEFAULT_SCHEDULE, enabled: false };

    // Regression test for the race this endpoint used to have: previously
    // each project was saved via its own concurrent POST, each doing its
    // own getConfig()-then-setConfig() - two edits in the same "Save all"
    // click could race, and whichever request's setConfig() landed last
    // would silently overwrite the other's change. Sending both in a single
    // POST (one getConfig/setConfig round trip) must persist both.
    const result = await handler(
      httpEvent("POST", { schedules: { pantry: newPantry, imposter: newImposter } })
    );
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body as string).schedules).toEqual({
      ...DEFAULT_CONFIG,
      pantry: newPantry,
      imposter: newImposter,
    });

    const putParamCalls = ssmMock.commandCalls(PutParameterCommand);
    expect(putParamCalls).toHaveLength(1);

    const persisted = JSON.parse(putParamCalls[0].args[0].input.Value as string);
    expect(persisted.pantry).toEqual(newPantry);
    expect(persisted.imposter).toEqual(newImposter);

    const updateCalls = schedulerMock.commandCalls(UpdateScheduleCommand);
    expect(updateCalls.map((c) => c.args[0].input.Name).sort()).toEqual(
      ["warm-off-pantry", "warm-on-pantry", "warm-off-imposter", "warm-on-imposter"].sort()
    );
  });
});

describe("warm-schedule handler - profiles", () => {
  function mockConfigAndProfiles(config: unknown, profiles: unknown): void {
    ssmMock
      .on(GetParameterCommand, { Name: "/warm-schedule/schedules" })
      .resolves({ Parameter: { Value: JSON.stringify(config) } });
    ssmMock
      .on(GetParameterCommand, { Name: "/warm-schedule/profiles" })
      .resolves({ Parameter: { Value: JSON.stringify(profiles) } });
    // No active reactive window by default - every code path here (via
    // buildStatus/applyProfile) also reads this param now.
    ssmMock.on(GetParameterCommand, { Name: "/warm-schedule/reactive-state" }).resolves({});
  }

  it("GET returns an empty profiles map by default", async () => {
    ssmMock.on(GetParameterCommand).resolves({});

    const result = await handler(httpEvent("GET"));
    expect(JSON.parse(result.body as string).profiles).toEqual({});
  });

  it("POST {profileAction: save} snapshots the current live config under the given name", async () => {
    mockConfigAndProfiles(DEFAULT_CONFIG, {});

    const result = await handler(httpEvent("POST", { profileAction: "save", name: "baseline" }));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body as string).profiles).toEqual({ baseline: DEFAULT_CONFIG });

    const putCalls = ssmMock.commandCalls(PutParameterCommand);
    const profilesPut = putCalls.find((c) => c.args[0].input.Name === "/warm-schedule/profiles")!;
    expect(JSON.parse(profilesPut.args[0].input.Value as string)).toEqual({ baseline: DEFAULT_CONFIG });
    // Saving never touches the live schedule config itself.
    expect(putCalls.find((c) => c.args[0].input.Name === "/warm-schedule/schedules")).toBeUndefined();
  });

  it("POST {profileAction: save} overwrites an existing profile of the same name", async () => {
    mockConfigAndProfiles(DEFAULT_CONFIG, { baseline: { some: "stale-config" } });

    await handler(httpEvent("POST", { profileAction: "save", name: "baseline" }));

    const putCalls = ssmMock.commandCalls(PutParameterCommand);
    const profilesPut = putCalls.find((c) => c.args[0].input.Name === "/warm-schedule/profiles")!;
    expect(JSON.parse(profilesPut.args[0].input.Value as string)).toEqual({ baseline: DEFAULT_CONFIG });
  });

  it("POST {profileAction: apply} loads the named profile as the live config and reconciles every project", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(WITHIN_WINDOW);

    const coldConfig = Object.fromEntries(
      Object.keys(DEFAULT_CONFIG).map((key) => [key, { ...DEFAULT_SCHEDULE, enabled: false }])
    );
    mockConfigAndProfiles(DEFAULT_CONFIG, { "all-cold": coldConfig });

    const result = await handler(httpEvent("POST", { profileAction: "apply", name: "all-cold" }));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body as string).schedules).toEqual(coldConfig);

    const schedulePut = ssmMock
      .commandCalls(PutParameterCommand)
      .find((c) => c.args[0].input.Name === "/warm-schedule/schedules")!;
    expect(JSON.parse(schedulePut.args[0].input.Value as string)).toEqual(coldConfig);

    // Every project's pair of on/off EventBridge Schedules gets updated, not
    // just one - this is what distinguishes "apply a profile" from an
    // individual project Save.
    const updateCalls = schedulerMock.commandCalls(UpdateScheduleCommand);
    expect(updateCalls).toHaveLength(12);
    expect(updateCalls.every((c) => c.args[0].input.State === "DISABLED")).toBe(true);

    // Reconciled immediately against every target, not just deferred to the
    // next backstop tick.
    const deleteCalls = lambdaMock.commandCalls(DeleteProvisionedConcurrencyConfigCommand);
    expect(deleteCalls).toHaveLength(ALL_TARGETS.length);
  });

  it("POST {profileAction: apply} with an unknown name 400s without touching any stored state", async () => {
    mockConfigAndProfiles(DEFAULT_CONFIG, {});

    const result = await handler(httpEvent("POST", { profileAction: "apply", name: "nope" }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string).error).toContain("nope");
    expect(ssmMock.commandCalls(PutParameterCommand)).toHaveLength(0);
    expect(schedulerMock.commandCalls(UpdateScheduleCommand)).toHaveLength(0);
  });

  it("POST {profileAction: delete} removes just the named profile", async () => {
    mockConfigAndProfiles(DEFAULT_CONFIG, { a: DEFAULT_CONFIG, b: DEFAULT_CONFIG });

    const result = await handler(httpEvent("POST", { profileAction: "delete", name: "a" }));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body as string).profiles).toEqual({ b: DEFAULT_CONFIG });

    const profilesPut = ssmMock
      .commandCalls(PutParameterCommand)
      .find((c) => c.args[0].input.Name === "/warm-schedule/profiles")!;
    expect(JSON.parse(profilesPut.args[0].input.Value as string)).toEqual({ b: DEFAULT_CONFIG });
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["blank", "   "],
    ["too long", "x".repeat(61)],
  ])("POST {profileAction: save} with a %s name returns 400", async (_label, name) => {
    mockConfigAndProfiles(DEFAULT_CONFIG, {});

    const result = await handler(httpEvent("POST", { profileAction: "save", name }));
    expect(result.statusCode).toBe(400);
    expect(ssmMock.commandCalls(PutParameterCommand)).toHaveLength(0);
  });

  it("POST with an unrecognized profileAction returns 400", async () => {
    const result = await handler(httpEvent("POST", { profileAction: "rename", name: "baseline" }));
    expect(result.statusCode).toBe(400);
  });
});

describe("warm-schedule handler - memory reconciliation", () => {
  it("skips the update/publish/move-alias sequence when live memory already matches desired", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(WITHIN_WINDOW);
    ssmMock.on(GetParameterCommand).resolves({});
    // Every target's live memory matches DEFAULT_SCHEDULE.memoryMb (512) -
    // overrides the beforeEach 256MB default for this test only.
    lambdaMock
      .on(GetFunctionConfigurationCommand)
      .resolves({ MemorySize: 512, LastUpdateStatus: "Successful" });

    await handler({ reconcile: true });

    expect(lambdaMock.commandCalls(UpdateFunctionConfigurationCommand)).toHaveLength(0);
    expect(lambdaMock.commandCalls(PublishVersionCommand)).toHaveLength(0);
    expect(lambdaMock.commandCalls(UpdateAliasCommand)).toHaveLength(0);
    // PC still gets (re-)granted as normal - memory being unchanged doesn't
    // skip the rest of reconcileTarget.
    expect(lambdaMock.commandCalls(PutProvisionedConcurrencyConfigCommand).length).toBeGreaterThan(0);
  });

  it("updates memory, publishes a version, and moves the live alias before granting PC when memory differs", async () => {
    ssmMock.on(GetParameterCommand).resolves({});

    const result = await handler({ project: "pantry", action: "on" });
    expect(result).toEqual({ statusCode: 200, headers: {}, body: "reconciled" });

    // beforeEach mocks live memory at 256MB; DEFAULT_SCHEDULE.memoryMb is 512.
    const updateCalls = lambdaMock.commandCalls(UpdateFunctionConfigurationCommand);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].args[0].input).toMatchObject({ FunctionName: "pantry-fn", MemorySize: 512 });

    expect(lambdaMock.commandCalls(PublishVersionCommand)).toHaveLength(1);
    expect(lambdaMock.commandCalls(PublishVersionCommand)[0].args[0].input.FunctionName).toBe("pantry-fn");

    const aliasCalls = lambdaMock.commandCalls(UpdateAliasCommand);
    expect(aliasCalls).toHaveLength(1);
    // "5" is PublishVersionCommand's mocked return Version (see beforeEach).
    expect(aliasCalls[0].args[0].input).toMatchObject({
      FunctionName: "pantry-fn",
      Name: "live",
      FunctionVersion: "5",
    });

    // PC is granted after the memory dance, against the same target.
    const putCalls = lambdaMock.commandCalls(PutProvisionedConcurrencyConfigCommand);
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].args[0].input.FunctionName).toBe("pantry-fn");
  });

  it("polls past an in-progress function update before publishing a version", async () => {
    ssmMock.on(GetParameterCommand).resolves({});
    // First call: the initial live-memory check (Qualifier: live). Second/
    // third calls: polling $LATEST's LastUpdateStatus - InProgress once,
    // then Successful, mirroring real AWS timing (confirmed live: typically
    // completes within a couple of 2s polls).
    lambdaMock
      .on(GetFunctionConfigurationCommand)
      .resolvesOnce({ MemorySize: 256, LastUpdateStatus: "Successful" })
      .resolvesOnce({ LastUpdateStatus: "InProgress" })
      .resolves({ LastUpdateStatus: "Successful" });

    const timers = vi.useFakeTimers({ toFake: ["setTimeout"] });
    const invokePromise = handler({ project: "pantry", action: "on" });
    // Let the poll loop's setTimeout(2000) fire without waiting 2 real
    // seconds - the loop awaits this before its next GetFunctionConfiguration.
    await vi.advanceTimersByTimeAsync(2000);

    const result = await invokePromise;
    timers.useRealTimers();

    expect(result).toEqual({ statusCode: 200, headers: {}, body: "reconciled" });
    expect(lambdaMock.commandCalls(PublishVersionCommand)).toHaveLength(1);
  });
});

describe("warm-schedule handler - weighted-alias self-heal", () => {
  // Reproduces the incident hit for real on 2026-07-27: AWS Lambda's own
  // PC-safety-net pins 100% of traffic to the last version that warmed via a
  // weighted RoutingConfig, and a weighted alias can never have PC attached.
  it("clears a weighted alias before granting PC, pinning to the version that was already serving all traffic", async () => {
    ssmMock.on(GetParameterCommand).resolves({});
    lambdaMock.on(GetAliasCommand).resolves({
      FunctionVersion: "12",
      RoutingConfig: { AdditionalVersionWeights: { "10": 1.0 } },
    });

    const result = await handler({ project: "pantry", action: "on" });
    expect(result).toEqual({ statusCode: 200, headers: {}, body: "reconciled" });

    // First UpdateAlias call clears the weighting; the second is
    // reconcileMemory's own move-alias call (beforeEach's 256MB live vs
    // 512MB desired still applies for this target).
    const aliasCalls = lambdaMock.commandCalls(UpdateAliasCommand);
    expect(aliasCalls[0].args[0].input).toMatchObject({
      FunctionName: "pantry-fn",
      Name: "live",
      FunctionVersion: "10",
      RoutingConfig: {},
    });

    // Self-healing doesn't block the rest of reconciliation - PC still gets granted.
    expect(lambdaMock.commandCalls(PutProvisionedConcurrencyConfigCommand).length).toBeGreaterThan(0);
  });

  it("does nothing when the alias has no weights", async () => {
    ssmMock.on(GetParameterCommand).resolves({});
    // Live memory already matches desired, so the only possible UpdateAlias
    // calls left are from the self-heal path itself.
    lambdaMock
      .on(GetFunctionConfigurationCommand)
      .resolves({ MemorySize: 512, LastUpdateStatus: "Successful" });

    await handler({ project: "pantry", action: "on" });

    expect(lambdaMock.commandCalls(UpdateAliasCommand)).toHaveLength(0);
  });
});

describe("warm-schedule handler - on/off trigger", () => {
  it("grants PC to a project's targets on an 'on' trigger, at its configured (default) concurrency", async () => {
    ssmMock.on(GetParameterCommand).resolves({});

    const result = await handler({ project: "imposter", action: "on" });
    expect(result).toEqual({ statusCode: 200, headers: {}, body: "reconciled" });

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
    expect(result).toEqual({ statusCode: 200, headers: {}, body: "reconciled" });

    const deleteCalls = lambdaMock.commandCalls(DeleteProvisionedConcurrencyConfigCommand);
    expect(deleteCalls.map((c) => c.args[0].input.FunctionName).sort()).toEqual([...ALL_ZTL_TARGETS].sort());
  });
});

describe("warm-schedule handler - reactive (cold-hit-triggered) PC", () => {
  const REACTIVE_STATE_NAME = "/warm-schedule/reactive-state";

  it("ignores a cold hit for a project with reactiveEnabled: false", async () => {
    ssmMock.on(GetParameterCommand).resolves({});

    const result = await handler(coldStartLogEvent("portfolio-fn"));
    expect(result.statusCode).toBe(200);

    expect(ssmMock.commandCalls(PutParameterCommand)).toHaveLength(0);
    expect(lambdaMock.commandCalls(PutProvisionedConcurrencyConfigCommand)).toHaveLength(0);
  });

  it("ignores a cold hit on a log group that doesn't map to any known target", async () => {
    ssmMock.on(GetParameterCommand).resolves({});

    const result = await handler(coldStartLogEvent("some-unrelated-function"));
    expect(result.statusCode).toBe(200);
    expect(ssmMock.commandCalls(PutParameterCommand)).toHaveLength(0);
  });

  it("grants PC and records a 1hr expiry on a cold hit when reactiveEnabled is true and no window is active", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(WITHIN_WINDOW);
    ssmMock.on(GetParameterCommand, { Name: "/warm-schedule/schedules" }).resolves({
      Parameter: { Value: JSON.stringify({ portfolio: { ...DEFAULT_SCHEDULE, reactiveEnabled: true } }) },
    });
    ssmMock.on(GetParameterCommand, { Name: REACTIVE_STATE_NAME }).resolves({});

    const result = await handler(coldStartLogEvent("portfolio-fn"));
    expect(result.statusCode).toBe(200);

    const stateWrites = ssmMock
      .commandCalls(PutParameterCommand)
      .filter((c) => c.args[0].input.Name === REACTIVE_STATE_NAME);
    expect(stateWrites).toHaveLength(1);
    const written = JSON.parse(stateWrites[0].args[0].input.Value as string);
    expect(written.portfolio).toBe(WITHIN_WINDOW.getTime() + 60 * 60_000);

    const putCalls = lambdaMock.commandCalls(PutProvisionedConcurrencyConfigCommand);
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].args[0].input.FunctionName).toBe("portfolio-fn");
  });

  it("does not extend an already-active reactive window on a second cold hit (fixed, not rolling)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(WITHIN_WINDOW);
    ssmMock.on(GetParameterCommand, { Name: "/warm-schedule/schedules" }).resolves({
      Parameter: { Value: JSON.stringify({ portfolio: { ...DEFAULT_SCHEDULE, reactiveEnabled: true } }) },
    });
    // Already active, 30 min still remaining.
    ssmMock.on(GetParameterCommand, { Name: REACTIVE_STATE_NAME }).resolves({
      Parameter: { Value: JSON.stringify({ portfolio: WITHIN_WINDOW.getTime() + 30 * 60_000 }) },
    });

    await handler(coldStartLogEvent("portfolio-fn"));

    expect(ssmMock.commandCalls(PutParameterCommand)).toHaveLength(0);
    expect(lambdaMock.commandCalls(PutProvisionedConcurrencyConfigCommand)).toHaveLength(0);
  });

  it("backstop reconcile keeps PC on for a project with an active reactive window even outside its schedule", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(OUTSIDE_WINDOW);
    ssmMock.on(GetParameterCommand, { Name: "/warm-schedule/schedules" }).resolves({
      Parameter: { Value: JSON.stringify({ portfolio: { ...DEFAULT_SCHEDULE, reactiveEnabled: true } }) },
    });
    ssmMock.on(GetParameterCommand, { Name: REACTIVE_STATE_NAME }).resolves({
      Parameter: { Value: JSON.stringify({ portfolio: OUTSIDE_WINDOW.getTime() + 10 * 60_000 }) },
    });

    await handler({ reconcile: true });

    const putCalls = lambdaMock.commandCalls(PutProvisionedConcurrencyConfigCommand);
    expect(putCalls.map((c) => c.args[0].input.FunctionName)).toContain("portfolio-fn");
    // Every other target has no active window and is outside its schedule -
    // still torn down as normal.
    const deleteCalls = lambdaMock.commandCalls(DeleteProvisionedConcurrencyConfigCommand);
    expect(deleteCalls.map((c) => c.args[0].input.FunctionName)).not.toContain("portfolio-fn");
    expect(deleteCalls.map((c) => c.args[0].input.FunctionName)).toContain("pantry-fn");
  });

  it("backstop reconcile tears PC down once a reactive window has expired outside the schedule", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(OUTSIDE_WINDOW);
    ssmMock.on(GetParameterCommand, { Name: "/warm-schedule/schedules" }).resolves({
      Parameter: { Value: JSON.stringify({ portfolio: { ...DEFAULT_SCHEDULE, reactiveEnabled: true } }) },
    });
    // Expired 1 minute ago.
    ssmMock.on(GetParameterCommand, { Name: REACTIVE_STATE_NAME }).resolves({
      Parameter: { Value: JSON.stringify({ portfolio: OUTSIDE_WINDOW.getTime() - 60_000 }) },
    });

    await handler({ reconcile: true });

    const deleteCalls = lambdaMock.commandCalls(DeleteProvisionedConcurrencyConfigCommand);
    expect(deleteCalls.map((c) => c.args[0].input.FunctionName)).toContain("portfolio-fn");
  });

  it("an 'off' schedule trigger does not tear down PC while a reactive window is still active for that project", async () => {
    ssmMock.on(GetParameterCommand, { Name: "/warm-schedule/schedules" }).resolves({
      Parameter: { Value: JSON.stringify({ portfolio: { ...DEFAULT_SCHEDULE, reactiveEnabled: true } }) },
    });
    ssmMock.on(GetParameterCommand, { Name: REACTIVE_STATE_NAME }).resolves({
      Parameter: { Value: JSON.stringify({ portfolio: Date.now() + 10 * 60_000 }) },
    });

    const result = await handler({ project: "portfolio", action: "off" });
    expect(result).toEqual({ statusCode: 200, headers: {}, body: "reconciled" });

    expect(lambdaMock.commandCalls(DeleteProvisionedConcurrencyConfigCommand)).toHaveLength(0);
    const putCalls = lambdaMock.commandCalls(PutProvisionedConcurrencyConfigCommand);
    expect(putCalls.map((c) => c.args[0].input.FunctionName)).toContain("portfolio-fn");
  });

  it("reports reactive status (active/until) alongside schedules and costs in the GET response", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(WITHIN_WINDOW);
    const until = WITHIN_WINDOW.getTime() + 10 * 60_000;
    ssmMock.on(GetParameterCommand, { Name: "/warm-schedule/schedules" }).resolves({
      Parameter: { Value: JSON.stringify({ portfolio: { ...DEFAULT_SCHEDULE, reactiveEnabled: true } }) },
    });
    ssmMock.on(GetParameterCommand, { Name: "/warm-schedule/profiles" }).resolves({});
    ssmMock
      .on(GetParameterCommand, { Name: REACTIVE_STATE_NAME })
      .resolves({ Parameter: { Value: JSON.stringify({ portfolio: until }) } });

    const result = await handler(httpEvent("GET"));
    const { reactive } = JSON.parse(result.body as string);

    expect(reactive.portfolio).toEqual({ active: true, until: new Date(until).toISOString() });
    expect(reactive.pantry).toEqual({ active: false, until: null });
  });
});

describe("warm-schedule handler - reconcile ping", () => {
  it("grants PC to every target when every project is enabled and within its window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(WITHIN_WINDOW);
    ssmMock.on(GetParameterCommand).resolves({});

    const result = await handler({ reconcile: true });
    expect(result).toEqual({ statusCode: 200, headers: {}, body: "reconciled" });

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
      ["portfolio-fn", "pantry-fn", "imposter-fn", "supergraph-fn", "design-studio-fn"].sort()
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
    expect(result).toEqual({ statusCode: 200, headers: {}, body: "reconciled" });
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
    expect(result).toEqual({ statusCode: 200, headers: {}, body: "reconciled" });
    expect(consoleErrorSpy).toHaveBeenCalled();

    // The other targets still got reconciled despite portfolio-fn's failure.
    const putCalls = lambdaMock.commandCalls(PutProvisionedConcurrencyConfigCommand);
    const succeededTargets = putCalls
      .filter((c) => c.args[0].input.FunctionName !== "portfolio-fn")
      .map((c) => c.args[0].input.FunctionName);
    expect(succeededTargets.sort()).toEqual(
      ["pantry-fn", "imposter-fn", "supergraph-fn", "design-studio-fn", ...ALL_ZTL_TARGETS].sort()
    );

    consoleErrorSpy.mockRestore();
  });
});
