import { describe, it, expect, vi, beforeEach } from "vitest";

const { AwsRumMock, recordError } = vi.hoisted(() => {
  const recordError = vi.fn();
  const AwsRumMock = vi.fn().mockImplementation(() => ({ recordError }));

  return { AwsRumMock, recordError };
});
vi.mock("aws-rum-web", () => ({ AwsRum: AwsRumMock }));

describe("rum", () => {
  beforeEach(() => {
    AwsRumMock.mockClear();
    recordError.mockClear();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("no-ops when the app monitor / identity pool ids aren't configured", async () => {
    vi.stubEnv("VITE_RUM_APP_MONITOR_ID", "");
    vi.stubEnv("VITE_RUM_IDENTITY_POOL_ID", "");

    const { initRum } = await import("./rum");

    initRum();

    expect(AwsRumMock).not.toHaveBeenCalled();
  });

  it("constructs AwsRum with the expected app monitor id, version, and region when configured", async () => {
    vi.stubEnv("VITE_RUM_APP_MONITOR_ID", "app-123");
    vi.stubEnv("VITE_RUM_IDENTITY_POOL_ID", "pool-456");

    const { initRum } = await import("./rum");

    initRum();

    expect(AwsRumMock).toHaveBeenCalledTimes(1);

    const [applicationId, version, region, config] = AwsRumMock.mock.calls[0];
    expect(applicationId).toBe("app-123");
    expect(version).toBe("1.0.0");
    expect(region).toBe("ap-southeast-2");
    expect(config.identityPoolId).toBe("pool-456");
    expect(config.endpoint).toBe("https://dataplane.rum.ap-southeast-2.amazonaws.com");
  });

  it("swallows errors thrown during initialization", async () => {
    vi.stubEnv("VITE_RUM_APP_MONITOR_ID", "app-123");
    vi.stubEnv("VITE_RUM_IDENTITY_POOL_ID", "pool-456");
    AwsRumMock.mockImplementationOnce(() => {
      throw new Error("boom");
    });

    const { initRum } = await import("./rum");

    expect(() => initRum()).not.toThrow();
  });

  it("recordRumError forwards to the initialized client", async () => {
    vi.stubEnv("VITE_RUM_APP_MONITOR_ID", "app-123");
    vi.stubEnv("VITE_RUM_IDENTITY_POOL_ID", "pool-456");

    const { initRum, recordRumError } = await import("./rum");
    initRum();

    const err = new Error("oops");
    recordRumError(err);

    expect(recordError).toHaveBeenCalledWith(err);
  });

  it("recordRumError no-ops when RUM was never initialized", async () => {
    vi.stubEnv("VITE_RUM_APP_MONITOR_ID", "");
    vi.stubEnv("VITE_RUM_IDENTITY_POOL_ID", "");

    const { recordRumError } = await import("./rum");

    expect(() => recordRumError(new Error("oops"))).not.toThrow();
    expect(recordError).not.toHaveBeenCalled();
  });
});
