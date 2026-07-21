import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { WarmSchedule } from "./useWarmSchedule";

const DEFAULT_SCHEDULE: WarmSchedule = {
  enabled: true,
  days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
  start: "08:00",
  end: "19:00",
};

const DEFAULT_CONFIG = {
  portfolio: DEFAULT_SCHEDULE,
  pantry: DEFAULT_SCHEDULE,
  imposter: DEFAULT_SCHEDULE,
  supergraph: DEFAULT_SCHEDULE,
  zeroTrustLab: DEFAULT_SCHEDULE,
};

describe("useWarmSchedule", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("reports unavailable and never fetches when no endpoint is configured", async () => {
    vi.stubEnv("VITE_WARM_SCHEDULE_ENDPOINT", "");

    const { useWarmSchedule } = await import("./useWarmSchedule");

    const { result } = renderHook(() => useWarmSchedule());

    expect(result.current.available).toBe(false);
    expect(result.current.config).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("loads the config from the endpoint on mount when available", async () => {
    vi.stubEnv("VITE_WARM_SCHEDULE_ENDPOINT", "https://api.test/warm-schedule");

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ json: async () => DEFAULT_CONFIG });

    const { useWarmSchedule } = await import("./useWarmSchedule");

    const { result } = renderHook(() => useWarmSchedule());

    expect(result.current.available).toBe(true);
    await waitFor(() => expect(result.current.config).toEqual(DEFAULT_CONFIG));
    expect(fetch).toHaveBeenCalledWith("https://api.test/warm-schedule");
  });

  it("surfaces an error when the initial load fails", async () => {
    vi.stubEnv("VITE_WARM_SCHEDULE_ENDPOINT", "https://api.test/warm-schedule");
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));

    const { useWarmSchedule } = await import("./useWarmSchedule");

    const { result } = renderHook(() => useWarmSchedule());

    await waitFor(() => expect(result.current.error).toBe("Couldn't load provisioned concurrency status"));
  });

  it("setSchedule POSTs the project/schedule and updates config from the response", async () => {
    vi.stubEnv("VITE_WARM_SCHEDULE_ENDPOINT", "https://api.test/warm-schedule");

    const newSchedule: WarmSchedule = {
      enabled: true,
      days: ["MON", "TUE", "WED", "THU", "FRI"],
      start: "07:30",
      end: "18:00",
    };
    const updatedConfig = { ...DEFAULT_CONFIG, pantry: newSchedule };
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ json: async () => DEFAULT_CONFIG })
      .mockResolvedValueOnce({ json: async () => updatedConfig });

    const { useWarmSchedule } = await import("./useWarmSchedule");

    const { result } = renderHook(() => useWarmSchedule());
    await waitFor(() => expect(result.current.config).toEqual(DEFAULT_CONFIG));

    act(() => {
      result.current.setSchedule("pantry", newSchedule);
    });

    expect(result.current.pendingFn).toBe("pantry");
    await waitFor(() => expect(result.current.config).toEqual(updatedConfig));
    expect(result.current.pendingFn).toBeNull();

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(init).toMatchObject({ method: "POST", headers: { "content-type": "application/json" } });
    expect(JSON.parse(init.body)).toEqual({ project: "pantry", schedule: newSchedule });
  });

  it("setSchedule only replaces the saved project's entry, preserving other projects' object identity", async () => {
    vi.stubEnv("VITE_WARM_SCHEDULE_ENDPOINT", "https://api.test/warm-schedule");

    const newSchedule: WarmSchedule = {
      enabled: true,
      days: ["MON", "TUE", "WED", "THU", "FRI"],
      start: "07:30",
      end: "18:00",
    };
    // The server always responds with the full config, same as GET - but a
    // fresh JSON.parse means every key is a new object reference, even ones
    // nothing changed for.
    const fullResponseConfig = JSON.parse(JSON.stringify({ ...DEFAULT_CONFIG, pantry: newSchedule }));
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ json: async () => DEFAULT_CONFIG })
      .mockResolvedValueOnce({ json: async () => fullResponseConfig });

    const { useWarmSchedule } = await import("./useWarmSchedule");

    const { result } = renderHook(() => useWarmSchedule());
    await waitFor(() => expect(result.current.config).toEqual(DEFAULT_CONFIG));

    const imposterBeforeSave = result.current.config!.imposter;

    act(() => {
      result.current.setSchedule("pantry", newSchedule);
    });
    await waitFor(() => expect(result.current.config!.pantry).toEqual(newSchedule));

    // Untouched project keeps the exact same object reference - a sibling
    // row's local draft (reset via reference-equality against this prop)
    // must not get discarded just because a different project was saved.
    expect(result.current.config!.imposter).toBe(imposterBeforeSave);
  });

  it("setSchedule surfaces an error and clears pendingFn on failure", async () => {
    vi.stubEnv("VITE_WARM_SCHEDULE_ENDPOINT", "https://api.test/warm-schedule");

    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ json: async () => DEFAULT_CONFIG })
      .mockRejectedValueOnce(new Error("network down"));

    const { useWarmSchedule } = await import("./useWarmSchedule");

    const { result } = renderHook(() => useWarmSchedule());
    await waitFor(() => expect(result.current.config).toEqual(DEFAULT_CONFIG));

    act(() => {
      result.current.setSchedule("pantry", DEFAULT_SCHEDULE);
    });

    await waitFor(() => expect(result.current.error).toBe("Couldn't update provisioned concurrency status"));
    expect(result.current.pendingFn).toBeNull();
  });

  it("setSchedule is a no-op when unavailable", async () => {
    vi.stubEnv("VITE_WARM_SCHEDULE_ENDPOINT", "");

    const { useWarmSchedule } = await import("./useWarmSchedule");

    const { result } = renderHook(() => useWarmSchedule());
    act(() => result.current.setSchedule("pantry", DEFAULT_SCHEDULE));

    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.pendingFn).toBeNull();
  });
});
