import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  LambdaClient,
  PutProvisionedConcurrencyConfigCommand,
  DeleteProvisionedConcurrencyConfigCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-lambda";
import { SSMClient, GetParameterCommand, PutParameterCommand } from "@aws-sdk/client-ssm";

// Read as module-level consts at import time in handler.ts. A static
// `import` is hoisted above these assignments regardless of where it's
// written textually (ES module semantics), so a dynamic import is used here
// instead to guarantee the env vars are set first.
process.env.LIVE_ALIAS_NAME = "live";
process.env.PC_CONFIG_PARAM_NAME = "/pc-config/flags";
process.env.PORTFOLIO_FN_NAME = "portfolio-fn";
process.env.PANTRY_FN_NAME = "pantry-fn";
process.env.IMPOSTER_FN_NAME = "imposter-fn";
process.env.ZTL_IDP_BRIDGE_FN_NAME = "ztl-idp-bridge-fn";
process.env.ZTL_INTERNAL_STS_FN_NAME = "ztl-internal-sts-fn";
process.env.ZTL_EDGE_AUTHORIZER_FN_NAME = "ztl-edge-authorizer-fn";
process.env.ZTL_EDGE_PROXY_FN_NAME = "ztl-edge-proxy-fn";
process.env.ZTL_DOMAIN_A_FN_NAME = "ztl-domain-a-fn";

const { handler } = await import("./handler");
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const lambdaMock = mockClient(LambdaClient);
const ssmMock = mockClient(SSMClient);

const ALL_ZTL_TARGETS = [
  "ztl-idp-bridge-fn",
  "ztl-internal-sts-fn",
  "ztl-edge-authorizer-fn",
  "ztl-edge-proxy-fn",
  "ztl-domain-a-fn",
];
const ALL_TARGETS = ["portfolio-fn", "pantry-fn", "imposter-fn", ...ALL_ZTL_TARGETS];

// 2026-07-20T00:00:00Z = 10:00 Sydney (AEST, UTC+10 - July is outside the
// Oct-April daylight-saving window) - within the 8am-7pm business-hours
// window.
const WITHIN_BUSINESS_HOURS = new Date("2026-07-20T00:00:00.000Z");
// Same calendar day, 22:00 Sydney - outside the window.
const OUTSIDE_BUSINESS_HOURS = new Date("2026-07-20T12:00:00.000Z");

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
  lambdaMock.on(PutProvisionedConcurrencyConfigCommand).resolves({});
  lambdaMock.on(DeleteProvisionedConcurrencyConfigCommand).resolves({});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("pc-config handler - flags GET/POST", () => {
  it("GET with no stored parameter returns the all-enabled defaults", async () => {
    ssmMock.on(GetParameterCommand).resolves({});

    const result = await handler(httpEvent("GET"));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body as string)).toEqual({
      portfolio: true,
      pantry: true,
      imposter: true,
      zeroTrustLab: true,
    });
  });

  it("GET merges a stored partial value over the defaults", async () => {
    ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: JSON.stringify({ portfolio: false }) } });

    const result = await handler(httpEvent("GET"));
    expect(JSON.parse(result.body as string)).toEqual({
      portfolio: false,
      pantry: true,
      imposter: true,
      zeroTrustLab: true,
    });
  });

  it("POST with a non-boolean enabled value returns 400", async () => {
    const result = await handler(httpEvent("POST", { function: "portfolio", enabled: "yes" }));
    expect(result.statusCode).toBe(400);
    expect(ssmMock.commandCalls(PutParameterCommand)).toHaveLength(0);
  });

  it("POST with an unrecognized function name returns 400", async () => {
    const result = await handler(httpEvent("POST", { function: "not-a-real-target", enabled: true }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string).error).toContain("portfolio/pantry/imposter/zeroTrustLab");
  });

  it("POST persists the updated flag set to SSM and reconciles only the changed target", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(WITHIN_BUSINESS_HOURS);
    // Deliberately an explicit stored Parameter rather than an empty response
    // - getFlags() returns its DEFAULT_FLAGS constant *by reference* when
    // there's no stored Parameter (see handler.ts's `if (!Parameter?.Value)
    // return DEFAULT_FLAGS;`), and the POST handler below mutates the object
    // it gets back (`flags[key] = body.enabled`). Hitting that branch here
    // would corrupt the shared DEFAULT_FLAGS singleton for every other test
    // in this file that also hits it (e.g. the reconcile-ping tests further
    // down, which rely on DEFAULT_FLAGS staying all-true). Giving an
    // explicit stored value forces getFlags() through its other branch,
    // which builds a fresh `{ ...DEFAULT_FLAGS, ...stored }` object instead.
    ssmMock.on(GetParameterCommand).resolves({
      Parameter: {
        Value: JSON.stringify({ portfolio: true, pantry: true, imposter: true, zeroTrustLab: true }),
      },
    });

    const result = await handler(httpEvent("POST", { function: "pantry", enabled: false }));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body as string)).toEqual({
      portfolio: true,
      pantry: false,
      imposter: true,
      zeroTrustLab: true,
    });

    const putParamCalls = ssmMock.commandCalls(PutParameterCommand);
    expect(putParamCalls).toHaveLength(1);
    expect(JSON.parse(putParamCalls[0].args[0].input.Value as string)).toEqual({
      portfolio: true,
      pantry: false,
      imposter: true,
      zeroTrustLab: true,
    });

    // Only pantry's flag changed, so only pantry-fn should be reconciled -
    // disabled and within business hours, so it should be torn down.
    const deleteCalls = lambdaMock.commandCalls(DeleteProvisionedConcurrencyConfigCommand);
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0].args[0].input.FunctionName).toBe("pantry-fn");
    expect(lambdaMock.commandCalls(PutProvisionedConcurrencyConfigCommand)).toHaveLength(0);
  });
});

describe("pc-config handler - reconcile ping", () => {
  it("grants PC to every target when all flags are enabled and it's within Sydney business hours", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(WITHIN_BUSINESS_HOURS);
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

  it("tears down PC on every target outside business hours, even when every flag is enabled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(OUTSIDE_BUSINESS_HOURS);
    ssmMock.on(GetParameterCommand).resolves({});

    await handler({ reconcile: true });

    const deleteCalls = lambdaMock.commandCalls(DeleteProvisionedConcurrencyConfigCommand);
    expect(deleteCalls.map((c) => c.args[0].input.FunctionName).sort()).toEqual([...ALL_TARGETS].sort());
    expect(lambdaMock.commandCalls(PutProvisionedConcurrencyConfigCommand)).toHaveLength(0);
  });

  it("tears down just the disabled flag's targets while granting PC to the rest within business hours", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(WITHIN_BUSINESS_HOURS);
    ssmMock
      .on(GetParameterCommand)
      .resolves({ Parameter: { Value: JSON.stringify({ zeroTrustLab: false }) } });

    await handler({ reconcile: true });

    const deleteCalls = lambdaMock.commandCalls(DeleteProvisionedConcurrencyConfigCommand);
    expect(deleteCalls.map((c) => c.args[0].input.FunctionName).sort()).toEqual([...ALL_ZTL_TARGETS].sort());

    const putCalls = lambdaMock.commandCalls(PutProvisionedConcurrencyConfigCommand);
    expect(putCalls.map((c) => c.args[0].input.FunctionName).sort()).toEqual(
      ["portfolio-fn", "pantry-fn", "imposter-fn"].sort()
    );
  });

  it("treats a ResourceNotFoundException on teardown as already-in-the-desired-state, not a failure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(OUTSIDE_BUSINESS_HOURS);
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
    vi.setSystemTime(WITHIN_BUSINESS_HOURS);
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
    expect(succeededTargets.sort()).toEqual(["pantry-fn", "imposter-fn", ...ALL_ZTL_TARGETS].sort());

    consoleErrorSpy.mockRestore();
  });
});
