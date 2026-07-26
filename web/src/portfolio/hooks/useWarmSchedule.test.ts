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
      json: async () => ({ schedules: DEFAULT_CONFIG, costs: DEFAULT_COSTS }),
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

  it("saveAll POSTs every dirty project and updates config from each response", async () => {
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
      .mockResolvedValueOnce({ json: async () => ({ schedules: DEFAULT_CONFIG, costs: DEFAULT_COSTS }) })
      .mockResolvedValueOnce({
        json: async () => ({ schedules: { ...DEFAULT_CONFIG, pantry: newPantry }, costs: DEFAULT_COSTS }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ schedules: { ...DEFAULT_CONFIG, imposter: newImposter }, costs: DEFAULT_COSTS }),
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

    const postCalls = (fetch as ReturnType<typeof vi.fn>).mock.calls.slice(1);
    expect(postCalls).toHaveLength(2);

    const bodies = postCalls.map(([, init]) => JSON.parse(init.body));
    expect(bodies).toContainEqual({ project: "pantry", schedule: newPantry });
    expect(bodies).toContainEqual({ project: "imposter", schedule: newImposter });
  });

  it("saveAll only replaces saved projects' entries, preserving untouched projects' object identity", async () => {
    vi.stubEnv("VITE_WARM_SCHEDULE_ENDPOINT", "https://api.test/warm-schedule");

    const newSchedule: WarmSchedule = {
      enabled: true,
      days: ["MON", "TUE", "WED", "THU", "FRI"],
      start: "07:30",
      end: "18:00",
      concurrency: 3,
      memoryMb: 1024,
    };
    // The server always responds with the full config, same as GET - but a
    // fresh JSON.parse means every key is a new object reference, even ones
    // nothing changed for.
    const fullResponseConfig = JSON.parse(JSON.stringify({ ...DEFAULT_CONFIG, pantry: newSchedule }));
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ json: async () => ({ schedules: DEFAULT_CONFIG, costs: DEFAULT_COSTS }) })
      .mockResolvedValueOnce({ json: async () => ({ schedules: fullResponseConfig, costs: DEFAULT_COSTS }) });

    const { useWarmSchedule } = await import("./useWarmSchedule");

    const { result } = renderHook(() => useWarmSchedule());
    await waitFor(() => expect(result.current.config).toEqual(DEFAULT_CONFIG));

    const imposterBeforeSave = result.current.config!.imposter;

    await act(() => result.current.saveAll({ pantry: newSchedule }));

    expect(result.current.config!.pantry).toEqual(newSchedule);
    // Untouched project keeps the exact same object reference.
    expect(result.current.config!.imposter).toBe(imposterBeforeSave);
  });

  it("saveAll surfaces an error and clears saving on failure", async () => {
    vi.stubEnv("VITE_WARM_SCHEDULE_ENDPOINT", "https://api.test/warm-schedule");

    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ json: async () => ({ schedules: DEFAULT_CONFIG, costs: DEFAULT_COSTS }) })
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
