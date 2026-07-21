import { describe, it, expect } from "vitest";

describe("supergraph handler", () => {
  // Default 5000ms timeout - importing this module pulls in @apollo/gateway's
  // whole dependency tree, which vitest has to transform on the fly; on a
  // cold cache (e.g. CI's first run after a fresh `npm ci`) that alone can
  // take longer than the default, well before the module body's own
  // synchronous throw ever runs.
  it("throws at module load when API_BASE_URL is not set", async () => {
    delete process.env.API_BASE_URL;
    await expect(import("./handler")).rejects.toThrow("API_BASE_URL is required");
  }, 20000);
});
