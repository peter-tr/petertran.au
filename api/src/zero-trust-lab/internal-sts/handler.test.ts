import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock's factory is hoisted above regular imports, so any variable it
// references must itself be declared inside vi.hoisted() - a plain top-level
// const would still be in its temporal dead zone when the hoisted factory
// runs (this fails with "Cannot access 'x' before initialization" otherwise).
const { signJwtMock, getJwksMock } = vi.hoisted(() => ({
  signJwtMock: vi.fn(async () => "signed-jwt"),
  getJwksMock: vi.fn(async () => ({
    keys: [{ kty: "RSA", n: "n-value", e: "AQAB", kid: "zero-trust-lab-key-1", use: "sig", alg: "RS256" }],
  })),
}));

// internal-sts/handler.ts only orchestrates routing/dispatch around
// signJwt/getJwks - the KMS-signing logic itself is covered directly in
// lib/jwt.test.ts, so mock the module here to isolate the handler's own
// branching (warmup short-circuit, HTTP vs. direct-invoke routing, path
// dispatch, and how it shapes the exchange claims).
vi.mock("../lib/jwt", () => ({
  signJwt: signJwtMock,
  getJwks: getJwksMock,
}));

// Read as a module-level const at import time in handler.ts. A static
// `import` is hoisted above this assignment regardless of where it's written
// textually (ES module semantics), so a dynamic import is used here instead
// to guarantee the env var is set first.
process.env.KMS_KEY_ID = "test-kms-key-id";

const { handler } = await import("./handler");
import type { APIGatewayProxyEventV2 } from "aws-lambda";

function httpEvent(rawPath: string, domainName = "internal-sts.example.com"): APIGatewayProxyEventV2 {
  return {
    rawPath,
    requestContext: { domainName },
  } as unknown as APIGatewayProxyEventV2;
}

beforeEach(() => {
  signJwtMock.mockClear();
  getJwksMock.mockClear();
});

describe("internal-sts handler", () => {
  it("short-circuits a warmup ping without calling KMS", async () => {
    const result = await handler({ warmup: true });
    expect(result).toEqual({ warm: true });
    expect(signJwtMock).not.toHaveBeenCalled();
    expect(getJwksMock).not.toHaveBeenCalled();
  });

  it("serves the JWKS document over the Function URL route", async () => {
    const result = await handler(httpEvent("/.well-known/jwks.json"));
    expect(result).toMatchObject({ statusCode: 200, headers: { "content-type": "application/json" } });
    expect(JSON.parse((result as { body: string }).body)).toEqual({
      keys: [{ kty: "RSA", n: "n-value", e: "AQAB", kid: "zero-trust-lab-key-1", use: "sig", alg: "RS256" }],
    });
    expect(getJwksMock).toHaveBeenCalledWith("test-kms-key-id", "zero-trust-lab-key-1");
  });

  it("serves OIDC discovery with an issuer/jwks_uri derived from the request's domainName", async () => {
    const result = await handler(httpEvent("/.well-known/openid-configuration", "sts.mysite.example"));
    expect(result).toMatchObject({ statusCode: 200 });
    expect(JSON.parse((result as { body: string }).body)).toEqual({
      issuer: "https://sts.mysite.example/",
      jwks_uri: "https://sts.mysite.example/.well-known/jwks.json",
    });
  });

  it("collapses a doubled slash in the raw path before route-matching", async () => {
    const result = await handler(httpEvent("//.well-known/jwks.json"));
    expect(result).toMatchObject({ statusCode: 200 });
    expect(getJwksMock).toHaveBeenCalled();
  });

  it("returns 404 for an unrecognized HTTP path", async () => {
    const result = await handler(httpEvent("/nonsense"));
    expect(result).toMatchObject({ statusCode: 404 });
  });

  it("treats a direct-invoke exchange request (no requestContext) as a token exchange, not an HTTP request", async () => {
    const result = await handler({
      claims: { sub: "user-1", scope: "read" },
      audience: "domain-a",
      issuer: "https://internal-sts.example.com/",
    });

    expect(result).toEqual({ jwt: "signed-jwt" });
  });

  it("builds JwtClaims from the exchange request's claims, audience, and issuer", async () => {
    await handler({
      claims: { sub: "user-7", scope: "write" },
      audience: "domain-b",
      issuer: "https://issuer.example.com/",
    });

    expect(signJwtMock).toHaveBeenCalledWith(
      { sub: "user-7", scope: "write", aud: "domain-b", iss: "https://issuer.example.com/" },
      "test-kms-key-id",
      "zero-trust-lab-key-1"
    );
  });

  it("omits scope from the signed claims when the exchange request has none", async () => {
    await handler({
      claims: { sub: "user-8" },
      audience: "domain-a",
      issuer: "https://issuer.example.com/",
    });

    expect(signJwtMock).toHaveBeenCalledWith(
      { sub: "user-8", scope: undefined, aud: "domain-a", iss: "https://issuer.example.com/" },
      "test-kms-key-id",
      "zero-trust-lab-key-1"
    );
  });
});
