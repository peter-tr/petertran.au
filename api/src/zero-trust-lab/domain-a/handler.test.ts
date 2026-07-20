import { describe, it, expect } from "vitest";
import { handler } from "./handler";
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";

describe("domain-a handler", () => {
  it("short-circuits a warmup ping", async () => {
    const result = await handler({ warmup: true });
    expect(result).toEqual({ statusCode: 200, body: "warm" });
  });

  it("echoes the validated JWT claims from the requestContext authorizer", async () => {
    const event = {
      requestContext: {
        authorizer: { jwt: { claims: { sub: "user-1", aud: "domain-a" }, scopes: null } },
      },
    } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;

    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    expect(result.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(result.body as string)).toEqual({
      message: "hello from domain-a",
      claims: { sub: "user-1", aud: "domain-a" },
    });
  });
});
