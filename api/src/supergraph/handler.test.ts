import { describe, it, expect } from "vitest";
import type { Context as LambdaContext } from "aws-lambda";

// Read as a module-level const at import time in handler.ts - set before the
// dynamic import below for the same reason as warmup/handler.test.ts.
process.env.API_BASE_URL = "https://api.test.petertran.au";

const { handler } = await import("./handler");

describe("supergraph handler", () => {
  it("short-circuits a warmup ping without triggering gateway composition", async () => {
    const result = await handler({ warmup: true }, {} as LambdaContext);
    expect(result).toEqual({ statusCode: 200, body: "warm" });
  });
});
