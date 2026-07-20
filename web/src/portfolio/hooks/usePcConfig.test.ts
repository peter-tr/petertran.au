import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

describe("usePcConfig", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("reports unavailable and never fetches when no endpoint is configured", async () => {
    vi.stubEnv("VITE_PC_CONFIG_ENDPOINT", "");

    const { usePcConfig } = await import("./usePcConfig");

    const { result } = renderHook(() => usePcConfig());

    expect(result.current.available).toBe(false);
    expect(result.current.flags).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("loads flags from the endpoint on mount when available", async () => {
    vi.stubEnv("VITE_PC_CONFIG_ENDPOINT", "https://api.test/pc-config");

    const flags = { portfolio: true, pantry: false, imposter: false, zeroTrustLab: false };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ json: async () => flags });

    const { usePcConfig } = await import("./usePcConfig");

    const { result } = renderHook(() => usePcConfig());

    expect(result.current.available).toBe(true);
    await waitFor(() => expect(result.current.flags).toEqual(flags));
    expect(fetch).toHaveBeenCalledWith("https://api.test/pc-config");
  });

  it("surfaces an error when the initial load fails", async () => {
    vi.stubEnv("VITE_PC_CONFIG_ENDPOINT", "https://api.test/pc-config");
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));

    const { usePcConfig } = await import("./usePcConfig");

    const { result } = renderHook(() => usePcConfig());

    await waitFor(() => expect(result.current.error).toBe("Couldn't load provisioned concurrency status"));
  });

  it("setEnabled POSTs the function/value and updates flags from the response", async () => {
    vi.stubEnv("VITE_PC_CONFIG_ENDPOINT", "https://api.test/pc-config");

    const initialFlags = { portfolio: false, pantry: false, imposter: false, zeroTrustLab: false };
    const updatedFlags = { ...initialFlags, pantry: true };
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ json: async () => initialFlags })
      .mockResolvedValueOnce({ json: async () => updatedFlags });

    const { usePcConfig } = await import("./usePcConfig");

    const { result } = renderHook(() => usePcConfig());
    await waitFor(() => expect(result.current.flags).toEqual(initialFlags));

    act(() => {
      result.current.setEnabled("pantry", true);
    });

    expect(result.current.pending).toBe(true);
    await waitFor(() => expect(result.current.flags).toEqual(updatedFlags));
    expect(result.current.pending).toBe(false);

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(init).toMatchObject({ method: "POST", headers: { "content-type": "application/json" } });
    expect(JSON.parse(init.body)).toEqual({ function: "pantry", enabled: true });
  });

  it("setEnabled surfaces an error and clears pending on failure", async () => {
    vi.stubEnv("VITE_PC_CONFIG_ENDPOINT", "https://api.test/pc-config");

    const initialFlags = { portfolio: false, pantry: false, imposter: false, zeroTrustLab: false };
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ json: async () => initialFlags })
      .mockRejectedValueOnce(new Error("network down"));

    const { usePcConfig } = await import("./usePcConfig");

    const { result } = renderHook(() => usePcConfig());
    await waitFor(() => expect(result.current.flags).toEqual(initialFlags));

    act(() => {
      result.current.setEnabled("pantry", true);
    });

    await waitFor(() => expect(result.current.error).toBe("Couldn't update provisioned concurrency status"));
    expect(result.current.pending).toBe(false);
  });

  it("setEnabled is a no-op when unavailable", async () => {
    vi.stubEnv("VITE_PC_CONFIG_ENDPOINT", "");

    const { usePcConfig } = await import("./usePcConfig");

    const { result } = renderHook(() => usePcConfig());
    act(() => result.current.setEnabled("pantry", true));

    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(false);
  });
});
