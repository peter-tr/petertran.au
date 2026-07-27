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

// Mirrors warm-schedule/handler.ts's own ColdStartStats - real counts from a
// CloudWatch Logs Insights query over the last 24h, only populated after
// "Check cold start rate" is clicked (this is on-demand, not fetched on
// page load, since the underlying query takes several seconds per project).
export interface ColdStartStats {
  coldStartCount: number;
  totalInvocations: number;
  coldStartPercent: number;
  error?: string;
}
export type WarmScheduleColdStarts = Record<WarmScheduleKey, ColdStartStats>;

// Named full-config snapshots (all 6 projects at once), keyed by
// user-chosen name - lets "Save current as profile" / "Apply" switch every
// project's schedule in one action instead of editing each row by hand.
export type WarmScheduleProfiles = Record<string, WarmScheduleConfig>;

interface WarmScheduleResponse {
  schedules: WarmScheduleConfig;
  costs: WarmScheduleCosts;
  profiles: WarmScheduleProfiles;
}

export function useWarmSchedule() {
  const [config, setConfigState] = useState<WarmScheduleConfig | null>(null);
  const [costs, setCosts] = useState<WarmScheduleCosts | null>(null);
  const [profiles, setProfiles] = useState<WarmScheduleProfiles | null>(null);
  const [coldStarts, setColdStarts] = useState<WarmScheduleColdStarts | null>(null);
  const [checkingColdStarts, setCheckingColdStarts] = useState(false);
  // One flag for the whole batch, not per-project - saveAll POSTs every
  // dirty project at once, so there's no meaningful "just this one row is
  // saving" state to track anymore (see PortfolioSettingsPage's single
  // "Save all" button).
  const [saving, setSaving] = useState(false);
  // Same per-item reasoning as elsewhere in this codebase, for whichever
  // profile name a save/apply/delete is currently in flight for.
  const [profilePending, setProfilePending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ENDPOINT) return;
    fetch(ENDPOINT)
      .then((res) => res.json())
      .then((data: WarmScheduleResponse) => {
        setConfigState(data.schedules);
        setCosts(data.costs);
        setProfiles(data.profiles);
      })
      .catch(() => setError("Couldn't load provisioned concurrency status"));
  }, []);

  // Sends every dirty project's schedule as one batched POST rather than one
  // request per project - the server merges and persists them in a single
  // read-modify-write, avoiding a race where two concurrent per-project
  // requests read the same stale config and the later one's write clobbers
  // the earlier one's (see handler.ts's POST branch), which used to make
  // "Save all" silently keep only the most recently edited project.
  const saveAll = useCallback(async (schedules: Partial<Record<WarmScheduleKey, WarmSchedule>>) => {
    if (!ENDPOINT || Object.keys(schedules).length === 0) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ schedules }),
      });
      const data: WarmScheduleResponse = await res.json();
      setConfigState(data.schedules);
      setCosts(data.costs);
      setProfiles(data.profiles);
    } catch {
      setError("Couldn't update provisioned concurrency status");
    } finally {
      setSaving(false);
    }
  }, []);

  const runProfileAction = useCallback(
    (name: string, profileAction: "save" | "apply" | "delete"): Promise<void> => {
      if (!ENDPOINT) return Promise.resolve();
      setProfilePending(name);
      setError(null);

      return fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileAction, name }),
      })
        .then((res) => res.json())
        .then((data: WarmScheduleResponse) => {
          // Unlike saveAll, "apply" can change every project's schedule at
          // once, so the whole config is replaced wholesale rather than
          // merged one key at a time.
          setConfigState(data.schedules);
          setCosts(data.costs);
          setProfiles(data.profiles);
        })
        .catch(() => setError(`Couldn't ${profileAction} profile "${name}"`))
        .finally(() => setProfilePending(null));
    },
    []
  );

  const saveProfile = useCallback((name: string) => runProfileAction(name, "save"), [runProfileAction]);
  const applyProfile = useCallback((name: string) => runProfileAction(name, "apply"), [runProfileAction]);
  const deleteProfile = useCallback((name: string) => runProfileAction(name, "delete"), [runProfileAction]);

  // A CloudWatch Logs Insights query per project (several seconds each), so
  // this is on-demand rather than fetched alongside schedules/costs on load.
  const checkColdStarts = useCallback(async () => {
    if (!ENDPOINT) return;

    setCheckingColdStarts(true);
    setError(null);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "checkColdStarts" }),
      });
      const data: { coldStarts: WarmScheduleColdStarts } = await res.json();
      setColdStarts(data.coldStarts);
    } catch {
      setError("Couldn't check cold start rate");
    } finally {
      setCheckingColdStarts(false);
    }
  }, []);

  return {
    config,
    costs,
    profiles,
    coldStarts,
    checkingColdStarts,
    saving,
    profilePending,
    error,
    saveAll,
    saveProfile,
    applyProfile,
    deleteProfile,
    checkColdStarts,
    available: Boolean(ENDPOINT),
  };
}
