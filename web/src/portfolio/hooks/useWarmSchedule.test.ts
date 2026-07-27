import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { schedulesEqual, isScheduleValid, type ProjectCost, type WarmSchedule } from "./useWarmSchedule";

const DEFAULT_SCHEDULE: WarmSchedule = {
  enabled: true,
  days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
  start: "08:00",
  end: "19:00",
  concurrency: 1,
  memoryMb: 512,
};

const DEFAULT_CONFIG = {
  portfolio: DEFAULT_SCHEDULE,
  pantry: DEFAULT_SCHEDULE,
  imposter: DEFAULT_SCHEDULE,
  supergraph: DEFAULT_SCHEDULE,
  zeroTrustLab: DEFAULT_SCHEDULE,
};

const NO_COST: ProjectCost = { liveConcurrency: 0, liveHourlyCostUsd: 0, scheduledMonthlyCostUsd: 0 };
const DEFAULT_COSTS = {
  portfolio: NO_COST,
  pantry: NO_COST,
  imposter: NO_COST,
  supergraph: NO_COST,
  zeroTrustLab: NO_COST,
};
const NO_PROFILES = {};

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

  it("loads the config and costs from the endpoint on mount when available", async () => {
    vi.stubEnv("VITE_WARM_SCHEDULE_ENDPOINT", "https://api.test/warm-schedule");

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({ schedules: DEFAULT_CONFIG, costs: DEFAULT_COSTS, profiles: NO_PROFILES }),
    });

    const { useWarmSchedule } = await import("./useWarmSchedule");

    const { result } = renderHook(() => useWarmSchedule());

    expect(result.current.available).toBe(true);
    await waitFor(() => expect(result.current.config).toEqual(DEFAULT_CONFIG));
    expect(result.current.costs).toEqual(DEFAULT_COSTS);
    expect(fetch).toHaveBeenCalledWith("https://api.test/warm-schedule");
  });

  it("surfaces an error when the initial load fails", async () => {
    vi.stubEnv("VITE_WARM_SCHEDULE_ENDPOINT", "https://api.test/warm-schedule");
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));

    const { useWarmSchedule } = await import("./useWarmSchedule");

    const { result } = renderHook(() => useWarmSchedule());

    await waitFor(() => expect(result.current.error).toBe("Couldn't load provisioned concurrency status"));
  });

  it("saveAll POSTs one batched request with every dirty project's schedule and replaces config from the response", async () => {
    vi.stubEnv("VITE_WARM_SCHEDULE_ENDPOINT", "https://api.test/warm-schedule");

    const newPantry: WarmSchedule = {
      enabled: true,
      days: ["MON", "TUE", "WED", "THU", "FRI"],
      start: "07:30",
      end: "18:00",
      concurrency: 3,
      memoryMb: 1024,
    };
    const newImposter: WarmSchedule = { ...DEFAULT_SCHEDULE, enabled: false };
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        json: async () => ({ schedules: DEFAULT_CONFIG, costs: DEFAULT_COSTS, profiles: NO_PROFILES }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          schedules: { ...DEFAULT_CONFIG, pantry: newPantry, imposter: newImposter },
          costs: DEFAULT_COSTS,
          profiles: NO_PROFILES,
        }),
      });

    const { useWarmSchedule } = await import("./useWarmSchedule");

    const { result } = renderHook(() => useWarmSchedule());
    await waitFor(() => expect(result.current.config).toEqual(DEFAULT_CONFIG));

    let savePromise!: Promise<void>;
    act(() => {
      savePromise = result.current.saveAll({ pantry: newPantry, imposter: newImposter });
    });

    expect(result.current.saving).toBe(true);
    await act(() => savePromise);
    expect(result.current.saving).toBe(false);

    expect(result.current.config).toEqual({ ...DEFAULT_CONFIG, pantry: newPantry, imposter: newImposter });

    // A single POST carrying both dirty projects, not one request per
    // project - avoids the race where two concurrent per-project requests
    // could clobber each other's write server-side.
    const postCalls = (fetch as ReturnType<typeof vi.fn>).mock.calls.slice(1);
    expect(postCalls).toHaveLength(1);
    expect(JSON.parse(postCalls[0][1].body)).toEqual({
      schedules: { pantry: newPantry, imposter: newImposter },
    });
  });

  it("saveAll surfaces an error and clears saving on failure", async () => {
    vi.stubEnv("VITE_WARM_SCHEDULE_ENDPOINT", "https://api.test/warm-schedule");

    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        json: async () => ({ schedules: DEFAULT_CONFIG, costs: DEFAULT_COSTS, profiles: NO_PROFILES }),
      })
      .mockRejectedValueOnce(new Error("network down"));

    const { useWarmSchedule } = await import("./useWarmSchedule");

    const { result } = renderHook(() => useWarmSchedule());
    await waitFor(() => expect(result.current.config).toEqual(DEFAULT_CONFIG));

    await act(() => result.current.saveAll({ pantry: DEFAULT_SCHEDULE }));

    expect(result.current.error).toBe("Couldn't update provisioned concurrency status");
    expect(result.current.saving).toBe(false);
  });

  it("saveAll is a no-op when unavailable or given no dirty projects", async () => {
    vi.stubEnv("VITE_WARM_SCHEDULE_ENDPOINT", "");

    const { useWarmSchedule } = await import("./useWarmSchedule");

    const { result } = renderHook(() => useWarmSchedule());
    await act(() => result.current.saveAll({ pantry: DEFAULT_SCHEDULE }));

    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.saving).toBe(false);
  });

  it("saveProfile POSTs {profileAction: save, name} and updates profiles from the response", async () => {
    vi.stubEnv("VITE_WARM_SCHEDULE_ENDPOINT", "https://api.test/warm-schedule");

    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        json: async () => ({ schedules: DEFAULT_CONFIG, costs: DEFAULT_COSTS, profiles: NO_PROFILES }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          schedules: DEFAULT_CONFIG,
          costs: DEFAULT_COSTS,
          profiles: { baseline: DEFAULT_CONFIG },
        }),
      });

    const { useWarmSchedule } = await import("./useWarmSchedule");

    const { result } = renderHook(() => useWarmSchedule());
    await waitFor(() => expect(result.current.config).toEqual(DEFAULT_CONFIG));

    act(() => {
      result.current.saveProfile("baseline");
    });

    expect(result.current.profilePending).toBe("baseline");
    await waitFor(() => expect(result.current.profiles).toEqual({ baseline: DEFAULT_CONFIG }));
    expect(result.current.profilePending).toBeNull();

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(JSON.parse(init.body)).toEqual({ profileAction: "save", name: "baseline" });
  });

  it("applyProfile replaces the whole config, not just one project", async () => {
    vi.stubEnv("VITE_WARM_SCHEDULE_ENDPOINT", "https://api.test/warm-schedule");

    const coldSchedule = { ...DEFAULT_SCHEDULE, enabled: false };
    const coldConfig = Object.fromEntries(Object.keys(DEFAULT_CONFIG).map((key) => [key, coldSchedule]));
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        json: async () => ({
          schedules: DEFAULT_CONFIG,
          costs: DEFAULT_COSTS,
          profiles: { "all-cold": coldConfig },
        }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          schedules: coldConfig,
          costs: DEFAULT_COSTS,
          profiles: { "all-cold": coldConfig },
        }),
      });

    const { useWarmSchedule } = await import("./useWarmSchedule");

    const { result } = renderHook(() => useWarmSchedule());
    await waitFor(() => expect(result.current.config).toEqual(DEFAULT_CONFIG));

    act(() => {
      result.current.applyProfile("all-cold");
    });

    await waitFor(() => expect(result.current.config).toEqual(coldConfig));

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(JSON.parse(init.body)).toEqual({ profileAction: "apply", name: "all-cold" });
  });

  it("deleteProfile POSTs {profileAction: delete, name} and removes it from profiles", async () => {
    vi.stubEnv("VITE_WARM_SCHEDULE_ENDPOINT", "https://api.test/warm-schedule");

    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        json: async () => ({
          schedules: DEFAULT_CONFIG,
          costs: DEFAULT_COSTS,
          profiles: { a: DEFAULT_CONFIG, b: DEFAULT_CONFIG },
        }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          schedules: DEFAULT_CONFIG,
          costs: DEFAULT_COSTS,
          profiles: { b: DEFAULT_CONFIG },
        }),
      });

    const { useWarmSchedule } = await import("./useWarmSchedule");

    const { result } = renderHook(() => useWarmSchedule());
    await waitFor(() => expect(result.current.profiles).toEqual({ a: DEFAULT_CONFIG, b: DEFAULT_CONFIG }));

    act(() => {
      result.current.deleteProfile("a");
    });

    await waitFor(() => expect(result.current.profiles).toEqual({ b: DEFAULT_CONFIG }));

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(JSON.parse(init.body)).toEqual({ profileAction: "delete", name: "a" });
  });
});

describe("schedulesEqual", () => {
  it("treats schedules with the same fields (days in any order) as equal", () => {
    const a: WarmSchedule = { ...DEFAULT_SCHEDULE, days: ["MON", "TUE"] };
    const b: WarmSchedule = { ...DEFAULT_SCHEDULE, days: ["TUE", "MON"] };

    expect(schedulesEqual(a, b)).toBe(true);
  });

  it("treats schedules that differ in any field as not equal", () => {
    expect(schedulesEqual(DEFAULT_SCHEDULE, { ...DEFAULT_SCHEDULE, concurrency: 2 })).toBe(false);
    expect(schedulesEqual(DEFAULT_SCHEDULE, { ...DEFAULT_SCHEDULE, memoryMb: 1024 })).toBe(false);
  });
});

describe("isScheduleValid", () => {
  it("skips validation entirely when disabled", () => {
    expect(isScheduleValid({ ...DEFAULT_SCHEDULE, enabled: false, days: [] })).toBe(true);
  });

  it("rejects an enabled schedule with no days, a bad time range, or an out-of-range concurrency/memory", () => {
    expect(isScheduleValid({ ...DEFAULT_SCHEDULE, days: [] })).toBe(false);
    expect(isScheduleValid({ ...DEFAULT_SCHEDULE, start: "19:00", end: "08:00" })).toBe(false);
    expect(isScheduleValid({ ...DEFAULT_SCHEDULE, concurrency: 0 })).toBe(false);
    expect(isScheduleValid({ ...DEFAULT_SCHEDULE, concurrency: 6 })).toBe(false);
    expect(isScheduleValid({ ...DEFAULT_SCHEDULE, memoryMb: 256 })).toBe(false);
  });

  it("accepts a valid enabled schedule", () => {
    expect(isScheduleValid(DEFAULT_SCHEDULE)).toBe(true);
  });
});
