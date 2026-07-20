import { describe, it, expect, vi, beforeEach } from "vitest";

const { clarityInit } = vi.hoisted(() => ({ clarityInit: vi.fn() }));
vi.mock("@microsoft/clarity", () => ({ default: { init: clarityInit } }));

describe("initClarity", () => {
  beforeEach(() => {
    clarityInit.mockClear();
    vi.resetModules();
  });

  it("no-ops outside production builds", async () => {
    vi.stubEnv("PROD", false);

    const { initClarity } = await import("./clarity");

    initClarity();

    expect(clarityInit).not.toHaveBeenCalled();
  });

  it("initializes Clarity with the project id in production", async () => {
    vi.stubEnv("PROD", true);

    const { initClarity } = await import("./clarity");

    initClarity();

    expect(clarityInit).toHaveBeenCalledWith("xod37pzsds");
  });
});
