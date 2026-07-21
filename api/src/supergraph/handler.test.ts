import { describe, it, expect } from "vitest";

describe("supergraph handler", () => {
  it("throws at module load when API_BASE_URL is not set", async () => {
    delete process.env.API_BASE_URL;
    await expect(import("./handler")).rejects.toThrow("API_BASE_URL is required");
  });
});
