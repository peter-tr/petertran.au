import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

// Read as module-level consts at import time in authorizer.ts, so these must
// be set before the module is first imported below.
process.env.IDP_BRIDGE_URL = "https://idp-bridge.example.com/";
process.env.INTERNAL_STS_FUNCTION_NAME = "internal-sts-fn";
process.env.INTERNAL_STS_ISSUER_URL = "https://internal-sts.example.com/";

import { handler } from "./authorizer";
import type { APIGatewayRequestAuthorizerEventV2 } from "aws-lambda";

const lambdaMock = mockClient(LambdaClient);

function authEvent(overrides: {
  rawPath: string;
  authorization?: string;
}): APIGatewayRequestAuthorizerEventV2 {
  return {
    rawPath: overrides.rawPath,
    headers: overrides.authorization ? { authorization: overrides.authorization } : {},
  } as unknown as APIGatewayRequestAuthorizerEventV2;
}

function mockIntrospectResponse(body: unknown, ok = true): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      json: () => Promise.resolve(body),
    })
  );
}

function mockInvokePayload(payload: unknown): void {
  lambdaMock.on(InvokeCommand).resolves({
    Payload: new TextEncoder().encode(JSON.stringify(payload)),
  });
}

beforeEach(() => {
  lambdaMock.reset();
  vi.unstubAllGlobals();
});

describe("edge authorizer handler", () => {
  it("denies a warmup ping without evaluating any real path (no fetch, no invoke)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await handler({ warmup: true });

    expect(result.isAuthorized).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(0);
  });

  it("denies when the Authorization header is missing", async () => {
    const result = await handler(authEvent({ rawPath: "/domain-a/foo" }));
    expect(result).toEqual({ isAuthorized: false, context: { jwt: "", sub: "" } });
  });

  it("denies when the path doesn't map to a known audience", async () => {
    const result = await handler(authEvent({ rawPath: "/unknown/foo", authorization: "Bearer opaque-token" }));
    expect(result.isAuthorized).toBe(false);
  });

  it("strips a Bearer prefix and accepts a capitalized Authorization header", async () => {
    mockIntrospectResponse({ active: true, sub: "user-1", scope: "read" });
    mockInvokePayload({ jwt: "signed-jwt" });

    const event = {
      rawPath: "/domain-a/foo",
      headers: { Authorization: "Bearer opaque-token" },
    } as unknown as APIGatewayRequestAuthorizerEventV2;

    const result = await handler(event);
    expect(result).toEqual({ isAuthorized: true, context: { jwt: "signed-jwt", sub: "user-1" } });
  });

  it("denies when introspection responds with a non-ok status", async () => {
    mockIntrospectResponse({}, false);

    const result = await handler(authEvent({ rawPath: "/domain-a/foo", authorization: "Bearer opaque-token" }));
    expect(result.isAuthorized).toBe(false);
  });

  it("denies when introspection reports the token as inactive", async () => {
    mockIntrospectResponse({ active: false });

    const result = await handler(authEvent({ rawPath: "/domain-a/foo", authorization: "Bearer opaque-token" }));
    expect(result.isAuthorized).toBe(false);
  });

  it("denies when introspection is active but has no sub", async () => {
    mockIntrospectResponse({ active: true });

    const result = await handler(authEvent({ rawPath: "/domain-a/foo", authorization: "Bearer opaque-token" }));
    expect(result.isAuthorized).toBe(false);
  });

  it("denies when the internal-sts invoke returns no payload", async () => {
    mockIntrospectResponse({ active: true, sub: "user-1" });
    lambdaMock.on(InvokeCommand).resolves({});

    const result = await handler(authEvent({ rawPath: "/domain-a/foo", authorization: "Bearer opaque-token" }));
    expect(result.isAuthorized).toBe(false);
  });

  it("denies when the internal-sts invoke payload has no jwt", async () => {
    mockIntrospectResponse({ active: true, sub: "user-1" });
    mockInvokePayload({});

    const result = await handler(authEvent({ rawPath: "/domain-a/foo", authorization: "Bearer opaque-token" }));
    expect(result.isAuthorized).toBe(false);
  });

  it("authorizes and returns the minted jwt and sub on a full successful chain", async () => {
    mockIntrospectResponse({ active: true, sub: "user-42", scope: "read" });
    mockInvokePayload({ jwt: "minted-jwt" });

    const result = await handler(authEvent({ rawPath: "/domain-a/foo", authorization: "Bearer opaque-token" }));
    expect(result).toEqual({ isAuthorized: true, context: { jwt: "minted-jwt", sub: "user-42" } });
  });

  it("invokes internal-sts on the live alias with the resolved audience, claims, and issuer", async () => {
    mockIntrospectResponse({ active: true, sub: "user-42", scope: "read" });
    mockInvokePayload({ jwt: "minted-jwt" });

    await handler(authEvent({ rawPath: "/domain-b/foo", authorization: "Bearer opaque-token" }));

    const calls = lambdaMock.commandCalls(InvokeCommand);
    expect(calls).toHaveLength(1);

    const input = calls[0].args[0].input;
    expect(input.FunctionName).toBe("internal-sts-fn");
    expect(input.Qualifier).toBe("live");

    const body = JSON.parse(Buffer.from(input.Payload as Uint8Array).toString("utf8"));
    expect(body).toEqual({
      claims: { sub: "user-42", scope: "read" },
      audience: "domain-b",
      issuer: "https://internal-sts.example.com/",
    });
  });

  it("posts the opaque token to the idp-bridge introspect endpoint", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ active: true, sub: "user-1" }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    mockInvokePayload({ jwt: "jwt" });

    await handler(authEvent({ rawPath: "/domain-a/foo", authorization: "Bearer opaque-token" }));

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://idp-bridge.example.com/introspect",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ token: "opaque-token" }),
      })
    );
  });
});
