import { useCallback, useEffect, useState } from "react";

// Direct read/write against ProvisionedConcurrencyStack's WarmScheduleFunction -
// same "not a per-browser preference" reasoning as the old warmup schedule
// toggle: this flips real Provisioned Concurrency for every visitor, per
// project (portfolio/pantry/imposter/supergraph/designStudio), on the
// days/times its own schedule says. zeroTrustLab is the one exception - it
// has no real visitors, so its schedule only affects how snappy your own
// manual testing of that lab feels.
const ENDPOINT = import.meta.env.VITE_WARM_SCHEDULE_ENDPOINT;

export type WarmScheduleKey =
  "portfolio" | "pantry" | "imposter" | "supergraph" | "designStudio" | "zeroTrustLab";
export type Weekday = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";

export interface WarmSchedule {
  enabled: boolean;
  days: Weekday[];
  start: string; // "HH:MM", 24h, Sydney-local
  end: string; // "HH:MM"
  concurrency: number; // ProvisionedConcurrentExecutions granted while within window
  memoryMb: number; // every target Lambda's memory
}

// Mirrors warm-schedule/handler.ts's own MAX_CONCURRENCY (the actual
// server-side validation bound) - kept in sync by hand, same "seeded in two
// places" duplication DEFAULT_SCHEDULE already has between the CDK stack and
// the handler's own fallback. Only used here to bound the settings page's
// number input before a save round-trips to the real check.
export const MAX_CONCURRENCY = 5;

// Mirrors warm-schedule/handler.ts's own MEMORY_OPTIONS_MB - the settings
// page's memory dropdown offers exactly these curated, actually-tested
// tiers rather than a free-form number input. Keep in sync by hand.
export const MEMORY_OPTIONS_MB = [512, 1024, 1536, 2048] as const;

export type WarmScheduleConfig = Record<WarmScheduleKey, WarmSchedule>;

export function schedulesEqual(a: WarmSchedule, b: WarmSchedule): boolean {
  return (
    a.enabled === b.enabled &&
    a.start === b.start &&
    a.end === b.end &&
    a.concurrency === b.concurrency &&
    a.memoryMb === b.memoryMb &&
    a.days.length === b.days.length &&
    a.days.every((d) => b.days.includes(d))
  );
}

// Mirrors warm-schedule/handler.ts's own isValidSchedule bounds (kept in
// sync by hand, same as MAX_CONCURRENCY/MEMORY_OPTIONS_MB above) - a
// disabled schedule skips validation entirely, matching the server.
export function isScheduleValid(schedule: WarmSchedule): boolean {
  if (!schedule.enabled) return true;

  return (
    schedule.days.length > 0 &&
    schedule.start < schedule.end &&
    Number.isInteger(schedule.concurrency) &&
    schedule.concurrency >= 1 &&
    schedule.concurrency <= MAX_CONCURRENCY &&
    (MEMORY_OPTIONS_MB as readonly number[]).includes(schedule.memoryMb)
  );
}

// Real, dynamically-computed price per project - queried live from each
// target Lambda's actual memory size and actual allocated Provisioned
// Concurrency (see api/src/warm-schedule/handler.ts's computeProjectCost),
// not a static estimate.
export interface ProjectCost {
  // Real PC units allocated right now (0 outside the window, or while AWS
  // is still provisioning/tearing down) - not necessarily the configured
  // `concurrency`, which is only the desired value.
  liveConcurrency: number;
  // $/hr this project is costing right now.
  liveHourlyCostUsd: number;
  // $/mo if the configured schedule runs as set - uses the schedule's own
  // memoryMb, so this reflects a pending memory choice before it's saved.
  scheduledMonthlyCostUsd: number;
}
export type WarmScheduleCosts = Record<WarmScheduleKey, ProjectCost>;

interface WarmScheduleResponse {
  schedules: WarmScheduleConfig;
  costs: WarmScheduleCosts;
}

export function useWarmSchedule() {
  const [config, setConfigState] = useState<WarmScheduleConfig | null>(null);
  const [costs, setCosts] = useState<WarmScheduleCosts | null>(null);
  // One flag for the whole batch, not per-project - saveAll POSTs every
  // dirty project at once, so there's no meaningful "just this one row is
  // saving" state to track anymore (see PortfolioSettingsPage's single
  // "Save all" button).
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ENDPOINT) return;
    fetch(ENDPOINT)
      .then((res) => res.json())
      .then((data: WarmScheduleResponse) => {
        setConfigState(data.schedules);
        setCosts(data.costs);
      })
      .catch(() => setError("Couldn't load provisioned concurrency status"));
  }, []);

  const saveAll = useCallback(async (schedules: Partial<Record<WarmScheduleKey, WarmSchedule>>) => {
    const entries = Object.entries(schedules) as [WarmScheduleKey, WarmSchedule][];
    if (!ENDPOINT || entries.length === 0) return;

    setSaving(true);
    setError(null);
    try {
      await Promise.all(
        entries.map(([fn, schedule]) =>
          fetch(ENDPOINT, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ project: fn, schedule }),
          })
            .then((res) => res.json())
            .then((data: WarmScheduleResponse) => {
              // Only replace this project's schedule entry, not the whole
              // config - a fresh object reference for every project (even
              // ones nothing changed for) would otherwise reset every other
              // row's in-progress draft too once the parent re-syncs drafts
              // from config. Costs are pure display, not tied to any draft
              // state, so the whole map is replaced.
              setConfigState((current) =>
                current ? { ...current, [fn]: data.schedules[fn] } : data.schedules
              );
              setCosts(data.costs);
            })
        )
      );
    } catch {
      setError("Couldn't update provisioned concurrency status");
    } finally {
      setSaving(false);
    }
  }, []);

  return { config, costs, saving, error, saveAll, available: Boolean(ENDPOINT) };
}
