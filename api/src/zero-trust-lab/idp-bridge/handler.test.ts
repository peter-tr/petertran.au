import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import {
  CognitoIdentityProviderClient,
  ListUserPoolClientsCommand,
  DescribeUserPoolClientCommand,
} from "@aws-sdk/client-cognito-identity-provider";

// Read as module-level consts at import time in handler.ts, so these must be
// set before the module is first imported below.
process.env.COGNITO_DOMAIN = "https://cognito.example.com";
process.env.USER_POOL_ID = "test-user-pool-id";

import { handler } from "./handler";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const ddbMock = mockClient(DynamoDBDocumentClient);
const cognitoMock = mockClient(CognitoIdentityProviderClient);

function jsonEvent(rawPath: string, body?: unknown, query?: Record<string, string>): APIGatewayProxyEventV2 {
  return {
    rawPath,
    queryStringParameters: query ?? null,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    isBase64Encoded: false,
    requestContext: { domainName: "idp.example.com" },
  } as unknown as APIGatewayProxyEventV2;
}

// A well-formed OIDC id_token shape (header.payload.signature) - only the
// payload is read by decodeIdTokenClaims, which deliberately doesn't verify
// the signature (see handler.ts's comment on why that's safe here).
function fakeIdToken(claims: { sub: string; email?: string }): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");

  return `${header}.${payload}.fake-signature`;
}

beforeEach(() => {
  ddbMock.reset();
  cognitoMock.reset();
  vi.unstubAllGlobals();

  // Configured fresh every test (reset() clears behavior, not the handler's
  // own module-level client-credential cache) so any test that happens to
  // hit the Cognito app-client lookup gets a valid response regardless of
  // whether an earlier test already primed the cache.
  cognitoMock.on(ListUserPoolClientsCommand).resolves({ UserPoolClients: [{ ClientId: "client-1" }] });
  cognitoMock.on(DescribeUserPoolClientCommand).resolves({ UserPoolClient: { ClientSecret: "secret-1" } });
});

describe("idp-bridge handler", () => {
  it("short-circuits a warmup ping", async () => {
    const result = await handler({ warmup: true });
    expect(result).toEqual({ statusCode: 200, body: "warm" });
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it("returns 404 for an unrecognized path", async () => {
    const result = await handler(jsonEvent("/nonsense"));
    expect(result.statusCode).toBe(404);
  });

  it("collapses a doubled slash before dispatching to /introspect", async () => {
    const result = await handler(jsonEvent("//introspect", { token: "missing-token" }));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body as string)).toEqual({ active: false });
  });

  describe("/callback", () => {
    it("returns 400 when the code query param is missing", async () => {
      const result = await handler(jsonEvent("/callback"));
      expect(result).toEqual({ statusCode: 400, body: "missing code" });
    });

    it("exchanges the code, mints an opaque token, and stores it in DynamoDB", async () => {
      const idToken = fakeIdToken({ sub: "cognito-sub-1", email: "user@example.com" });
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id_token: idToken }),
      });
      vi.stubGlobal("fetch", fetchSpy);
      ddbMock.on(PutCommand).resolves({});

      const result = await handler(jsonEvent("/callback", undefined, { code: "auth-code-1" }));

      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body as string) as { access_token: string; token_type: string };
      expect(body.token_type).toBe("opaque");
      expect(typeof body.access_token).toBe("string");
      expect(body.access_token.length).toBeGreaterThan(0);

      const putCalls = ddbMock.commandCalls(PutCommand);
      expect(putCalls).toHaveLength(1);

      const item = putCalls[0].args[0].input.Item as Record<string, unknown>;
      expect(item.pk).toBe(body.access_token);
      expect(item.sub).toBe("cognito-sub-1");
      expect(item.email).toBe("user@example.com");
      expect(item.scope).toBe("read");
      expect(typeof item.ttl).toBe("number");
    });

    it("derives the redirect_uri from the request's domainName and authenticates with the Cognito app client's basic auth", async () => {
      const idToken = fakeIdToken({ sub: "cognito-sub-1" });
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id_token: idToken }),
      });
      vi.stubGlobal("fetch", fetchSpy);
      ddbMock.on(PutCommand).resolves({});

      await handler(jsonEvent("/callback", undefined, { code: "auth-code-1" }));

      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://cognito.example.com/oauth2/token");
      expect(init.method).toBe("POST");

      const expectedBasicAuth = Buffer.from("client-1:secret-1").toString("base64");
      expect((init.headers as Record<string, string>).authorization).toBe(`Basic ${expectedBasicAuth}`);

      const params = init.body as URLSearchParams;
      expect(params.get("grant_type")).toBe("authorization_code");
      expect(params.get("client_id")).toBe("client-1");
      expect(params.get("code")).toBe("auth-code-1");
      expect(params.get("redirect_uri")).toBe("https://idp.example.com/callback");
    });

    it("returns 502 when the Cognito token exchange fails", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: false,
        text: () => Promise.resolve("invalid_grant"),
      });
      vi.stubGlobal("fetch", fetchSpy);

      const result = await handler(jsonEvent("/callback", undefined, { code: "bad-code" }));
      expect(result.statusCode).toBe(502);
      expect(result.body).toContain("invalid_grant");
    });

    it("reuses the cached Cognito app client credentials across repeated callbacks", async () => {
      const idToken = fakeIdToken({ sub: "cognito-sub-1" });
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id_token: idToken }),
      });
      vi.stubGlobal("fetch", fetchSpy);
      ddbMock.on(PutCommand).resolves({});

      await handler(jsonEvent("/callback", undefined, { code: "auth-code-1" }));
      await handler(jsonEvent("/callback", undefined, { code: "auth-code-2" }));

      // Whether or not an earlier test in this file already primed the
      // module-level credential cache, a *second* callback in the same test
      // must never trigger a second app-client lookup - at most one lookup
      // total across both calls proves the cache is doing its job rather
      // than a Cognito API round trip happening on every request.
      expect(cognitoMock.commandCalls(ListUserPoolClientsCommand).length).toBeLessThanOrEqual(1);
      expect(cognitoMock.commandCalls(DescribeUserPoolClientCommand).length).toBeLessThanOrEqual(1);
    });
  });

  describe("/introspect", () => {
    it("returns 400 with active:false when the token is missing from the body", async () => {
      const result = await handler(jsonEvent("/introspect", {}));
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body as string)).toEqual({ active: false });
    });

    it("returns active:false when the token isn't found in DynamoDB", async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined });

      const result = await handler(jsonEvent("/introspect", { token: "unknown-token" }));
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body as string)).toEqual({ active: false });
    });

    it("returns active:false when the stored token has expired", async () => {
      const now = Math.floor(Date.now() / 1000);
      ddbMock.on(GetCommand).resolves({ Item: { pk: "expired-token", sub: "user-1", ttl: now - 60 } });

      const result = await handler(jsonEvent("/introspect", { token: "expired-token" }));
      expect(JSON.parse(result.body as string)).toEqual({ active: false });
    });

    it("returns active:true with sub/scope/exp for a valid, unexpired token", async () => {
      const now = Math.floor(Date.now() / 1000);
      ddbMock.on(GetCommand).resolves({ Item: { pk: "good-token", sub: "user-1", scope: "read", ttl: now + 3600 } });

      const result = await handler(jsonEvent("/introspect", { token: "good-token" }));
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body as string)).toEqual({
        active: true,
        sub: "user-1",
        scope: "read",
        exp: now + 3600,
      });
    });
  });

  describe("/logout", () => {
    it("returns 400 when the token is missing from the body", async () => {
      const result = await handler(jsonEvent("/logout", {}));
      expect(result).toEqual({ statusCode: 400, body: "missing token" });
    });

    it("deletes the token's DynamoDB row and confirms logout", async () => {
      ddbMock.on(DeleteCommand).resolves({});

      const result = await handler(jsonEvent("/logout", { token: "some-token" }));
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body as string)).toEqual({ loggedOut: true });

      const deleteCalls = ddbMock.commandCalls(DeleteCommand);
      expect(deleteCalls).toHaveLength(1);
      expect(deleteCalls[0].args[0].input.Key).toEqual({ pk: "some-token" });
    });
  });
});
