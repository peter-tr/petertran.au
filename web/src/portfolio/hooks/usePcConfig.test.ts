import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PcSchedule } from "./usePcConfig";

const DEFAULT_SCHEDULE: PcSchedule = {
  enabled: true,
  days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
  start: "08:00",
  end: "19:00",
};

const DEFAULT_CONFIG = {
  portfolio: DEFAULT_SCHEDULE,
  pantry: DEFAULT_SCHEDULE,
  imposter: DEFAULT_SCHEDULE,
  zeroTrustLab: DEFAULT_SCHEDULE,
};

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
    expect(result.current.config).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("loads the config from the endpoint on mount when available", async () => {
    vi.stubEnv("VITE_PC_CONFIG_ENDPOINT", "https://api.test/pc-config");

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ json: async () => DEFAULT_CONFIG });

    const { usePcConfig } = await import("./usePcConfig");

    const { result } = renderHook(() => usePcConfig());

    expect(result.current.available).toBe(true);
    await waitFor(() => expect(result.current.config).toEqual(DEFAULT_CONFIG));
    expect(fetch).toHaveBeenCalledWith("https://api.test/pc-config");
  });

  it("surfaces an error when the initial load fails", async () => {
    vi.stubEnv("VITE_PC_CONFIG_ENDPOINT", "https://api.test/pc-config");
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));

    const { usePcConfig } = await import("./usePcConfig");

    const { result } = renderHook(() => usePcConfig());

    await waitFor(() => expect(result.current.error).toBe("Couldn't load provisioned concurrency status"));
  });

  it("setSchedule POSTs the project/schedule and updates config from the response", async () => {
    vi.stubEnv("VITE_PC_CONFIG_ENDPOINT", "https://api.test/pc-config");

    const newSchedule: PcSchedule = {
      enabled: true,
      days: ["MON", "TUE", "WED", "THU", "FRI"],
      start: "07:30",
      end: "18:00",
    };
    const updatedConfig = { ...DEFAULT_CONFIG, pantry: newSchedule };
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ json: async () => DEFAULT_CONFIG })
      .mockResolvedValueOnce({ json: async () => updatedConfig });

    const { usePcConfig } = await import("./usePcConfig");

    const { result } = renderHook(() => usePcConfig());
    await waitFor(() => expect(result.current.config).toEqual(DEFAULT_CONFIG));

    act(() => {
      result.current.setSchedule("pantry", newSchedule);
    });

    expect(result.current.pending).toBe(true);
    await waitFor(() => expect(result.current.config).toEqual(updatedConfig));
    expect(result.current.pending).toBe(false);

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(init).toMatchObject({ method: "POST", headers: { "content-type": "application/json" } });
    expect(JSON.parse(init.body)).toEqual({ project: "pantry", schedule: newSchedule });
  });

  it("setSchedule surfaces an error and clears pending on failure", async () => {
    vi.stubEnv("VITE_PC_CONFIG_ENDPOINT", "https://api.test/pc-config");

    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ json: async () => DEFAULT_CONFIG })
      .mockRejectedValueOnce(new Error("network down"));

    const { usePcConfig } = await import("./usePcConfig");

    const { result } = renderHook(() => usePcConfig());
    await waitFor(() => expect(result.current.config).toEqual(DEFAULT_CONFIG));

    act(() => {
      result.current.setSchedule("pantry", DEFAULT_SCHEDULE);
    });

    await waitFor(() => expect(result.current.error).toBe("Couldn't update provisioned concurrency status"));
    expect(result.current.pending).toBe(false);
  });

  it("setSchedule is a no-op when unavailable", async () => {
    vi.stubEnv("VITE_PC_CONFIG_ENDPOINT", "");

    const { usePcConfig } = await import("./usePcConfig");

    const { result } = renderHook(() => usePcConfig());
    act(() => result.current.setSchedule("pantry", DEFAULT_SCHEDULE));

    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(false);
  });
});
