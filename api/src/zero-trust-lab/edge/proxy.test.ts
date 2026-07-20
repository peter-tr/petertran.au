import { describe, it, expect, beforeEach, vi } from "vitest";

// Read as module-level consts at import time in proxy.ts. A static `import`
// is hoisted above these assignments regardless of where it's written
// textually (ES module semantics), so a dynamic import is used here instead
// to guarantee the env vars are set first.
process.env.DOMAIN_A_URL = "https://domain-a.example.com/";
process.env.DOMAIN_B_URL = "https://domain-b.example.com";

const { handler } = await import("./proxy");
import type { APIGatewayProxyEventV2WithLambdaAuthorizer } from "aws-lambda";
import type { EdgeAuthContext } from "./authorizer";

type ProxyEvent = APIGatewayProxyEventV2WithLambdaAuthorizer<EdgeAuthContext>;

function proxyEvent(rawPath: string, jwt = "signed-jwt", method = "GET"): ProxyEvent {
  return {
    rawPath,
    requestContext: {
      http: { method },
      authorizer: { lambda: { jwt, sub: "user-1" } },
    },
  } as unknown as ProxyEvent;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("edge proxy handler", () => {
  it("short-circuits a warmup ping without forwarding anywhere", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await handler({ warmup: true });

    expect(result).toEqual({ statusCode: 200, body: "warm" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 404 for an unrecognized domain prefix", async () => {
    const result = await handler(proxyEvent("/domain-c/foo"));
    expect(result.statusCode).toBe(404);
  });

  it("forwards to DOMAIN_A_URL with the remaining path segments joined", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      status: 200,
      text: () => Promise.resolve('{"ok":true}'),
      headers: new Headers({ "content-type": "application/json" }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await handler(proxyEvent("/domain-a/foo/bar", "signed-jwt", "PUT"));

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://domain-a.example.com/foo/bar",
      expect.objectContaining({
        method: "PUT",
        headers: { authorization: "Bearer signed-jwt" },
      })
    );
  });

  it("forwards to DOMAIN_B_URL for the domain-b prefix", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      status: 200,
      text: () => Promise.resolve("ok"),
      headers: new Headers(),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await handler(proxyEvent("/domain-b/baz"));

    expect(fetchSpy).toHaveBeenCalledWith("https://domain-b.example.com/baz", expect.anything());
  });

  it("relays the upstream status code and body back to the caller", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      status: 503,
      text: () => Promise.resolve("upstream down"),
      headers: new Headers(),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await handler(proxyEvent("/domain-a/foo"));
    expect(result.statusCode).toBe(503);
    expect(result.body).toBe("upstream down");
  });

  it("defaults content-type to application/json and echoes the jwt in x-debug-jwt", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      status: 200,
      text: () => Promise.resolve("plain text"),
      headers: new Headers(),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await handler(proxyEvent("/domain-a/foo", "the-jwt"));
    expect(result.headers).toEqual({ "content-type": "application/json", "x-debug-jwt": "the-jwt" });
  });

  it("passes through the upstream content-type when present", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      status: 200,
      text: () => Promise.resolve("<html></html>"),
      headers: new Headers({ "content-type": "text/html" }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await handler(proxyEvent("/domain-a/foo"));
    expect(result.headers?.["content-type"]).toBe("text/html");
  });
});
