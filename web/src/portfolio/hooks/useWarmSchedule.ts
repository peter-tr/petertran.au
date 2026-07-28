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
  // Opt-in: grants PC for 1hr after a real cold hit on this project,
  // independent of (and additive to) the scheduled window above - see
  // api/src/warm-schedule/handler.ts's handleColdHit/isWithinReactiveWindow.
  reactiveEnabled: boolean;
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
    a.reactiveEnabled === b.reactiveEnabled &&
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
  // Estimate (not a Cost-Explorer-verified bill) - see handler.ts's
  // ProjectCost for exactly what this combines.
  last24hCostUsd: number;
}
export type WarmScheduleCosts = Record<WarmScheduleKey, ProjectCost>;

// Mirrors warm-schedule/handler.ts's own ReactiveStatus - whether a real
// cold hit has granted this project PC for the next hour right now, and
// when that grant expires (null when inactive).
export interface ReactiveStatus {
  active: boolean;
  until: string | null;
}
export type WarmScheduleReactive = Record<WarmScheduleKey, ReactiveStatus>;

// Mirrors warm-schedule/handler.ts's own ColdStartStats - real counts from a
// CloudWatch Logs Insights query over the selected lookback window, fetched
// automatically (on mount and whenever the window selection changes, see
// useWarmSchedule below) since a single check across all 6 projects
// completes in a few seconds, not the "several seconds per project" this
// comment used to warn about needing an explicit button for.
export interface ColdStartStats {
  coldStartCount: number;
  totalInvocations: number;
  coldStartPercent: number;
  error?: string;
}
export type WarmScheduleColdStarts = Record<WarmScheduleKey, ColdStartStats>;

// Mirrors warm-schedule/handler.ts's own ALLOWED_COLD_START_WINDOW_MINUTES -
// the settings page's window picker offers exactly these curated lookback
// windows rather than a free-form input. Keep in sync by hand.
export const COLD_START_WINDOW_OPTIONS = [
  { label: "10 min", minutes: 10 },
  { label: "1 hour", minutes: 60 },
  { label: "24 hours", minutes: 1440 },
] as const;

const DEFAULT_COLD_START_WINDOW_MINUTES = 1440;

// Per-browser preference (no login/account system here, same reasoning as
// useShowAlsoBuilt/useShowFooterCost) - remembers the last-picked lookback
// window across visits instead of resetting to the 24h default every time
// the settings page loads.
const COLD_START_WINDOW_STORAGE_KEY = "portfolio:coldStartWindowMinutes";

function readStoredColdStartWindowMinutes(): number {
  try {
    const raw = localStorage.getItem(COLD_START_WINDOW_STORAGE_KEY);
    const parsed = raw === null ? NaN : Number(raw);

    return isValidColdStartWindowMinutes(parsed) ? parsed : DEFAULT_COLD_START_WINDOW_MINUTES;
  } catch {
    // Storage unavailable (private browsing, quota, etc.) -- fall back to
    // the default, same as a fresh visitor with no stored preference.
    return DEFAULT_COLD_START_WINDOW_MINUTES;
  }
}

function isValidColdStartWindowMinutes(value: number): boolean {
  return COLD_START_WINDOW_OPTIONS.some((option) => option.minutes === value);
}

// Named full-config snapshots (all 6 projects at once), keyed by
// user-chosen name - lets "Save current as profile" / "Apply" switch every
// project's schedule in one action instead of editing each row by hand.
export type WarmScheduleProfiles = Record<string, WarmScheduleConfig>;

interface WarmScheduleResponse {
  schedules: WarmScheduleConfig;
  costs: WarmScheduleCosts;
  profiles: WarmScheduleProfiles;
  reactive: WarmScheduleReactive;
}

export function useWarmSchedule() {
  const [config, setConfig] = useState<WarmScheduleConfig | null>(null);
  const [costs, setCosts] = useState<WarmScheduleCosts | null>(null);
  const [profiles, setProfiles] = useState<WarmScheduleProfiles | null>(null);
  const [reactive, setReactive] = useState<WarmScheduleReactive | null>(null);
  const [coldStarts, setColdStarts] = useState<WarmScheduleColdStarts | null>(null);
  // Starts true - a check always begins immediately on mount.
  const [checkingColdStarts, setCheckingColdStarts] = useState(true);
  const [coldStartWindowMinutes, setColdStartWindowMinutesState] = useState(readStoredColdStartWindowMinutes);
  const setColdStartWindowMinutes = useCallback((minutes: number) => {
    try {
      localStorage.setItem(COLD_START_WINDOW_STORAGE_KEY, String(minutes));
    } catch {
      // Fail silently -- this preference is a convenience, not a requirement.
    }
    setColdStartWindowMinutesState(minutes);
  }, []);
  // Same "adjust state during render" idiom PortfolioSettingsPage.tsx's own
  // warmScheduleDrafts reset uses: flips checkingColdStarts back to true the
  // instant the window selection changes, synchronously during render - not
  // inside the effect below, which would trip react-hooks/set-state-in-effect
  // (every setState reachable from that effect must stay inside a promise
  // callback, never called eagerly at the top of the effect body).
  const [checkedColdStartWindowMinutes, setCheckedColdStartWindowMinutes] = useState(coldStartWindowMinutes);
  if (coldStartWindowMinutes !== checkedColdStartWindowMinutes) {
    setCheckedColdStartWindowMinutes(coldStartWindowMinutes);
    setCheckingColdStarts(true);
  }

  // One flag for the whole batch, not per-project - saveAll POSTs every
  // dirty project at once, so there's no meaningful "just this one row is
  // saving" state to track anymore (see PortfolioSettingsPage's single
  // "Save all" button).
  const [saving, setSaving] = useState(false);
  // Same per-item reasoning as elsewhere in this codebase, for whichever
  // profile name a save/apply/delete is currently in flight for.
  const [profilePending, setProfilePending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Separate from `error` - the cold-start check now runs automatically in
  // its own effect, independent of the initial config load, so sharing one
  // error string between them would let whichever settles last silently
  // overwrite the other's message.
  const [coldStartError, setColdStartError] = useState<string | null>(null);

  // Shared by the mount effect and the settings page's manual "Refresh
  // status" button - the initial config/costs/profiles/reactive load only
  // ever happens once (or after a save), so a reactive window's countdown
  // would otherwise go stale until the next edit.
  const refresh = useCallback(() => {
    if (!ENDPOINT) return Promise.resolve();

    return fetch(ENDPOINT)
      .then((res) => res.json())
      .then((data: WarmScheduleResponse) => {
        setConfig(data.schedules);
        setCosts(data.costs);
        setProfiles(data.profiles);
        setReactive(data.reactive);
        setError(null);
      })
      .catch(() => setError("Couldn't load provisioned concurrency status"));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

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
      setConfig(data.schedules);
      setCosts(data.costs);
      setProfiles(data.profiles);
      setReactive(data.reactive);
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
          setConfig(data.schedules);
          setCosts(data.costs);
          setProfiles(data.profiles);
          setReactive(data.reactive);
        })
        .catch(() => setError(`Couldn't ${profileAction} profile "${name}"`))
        .finally(() => setProfilePending(null));
    },
    []
  );

  const saveProfile = useCallback((name: string) => runProfileAction(name, "save"), [runProfileAction]);
  const applyProfile = useCallback((name: string) => runProfileAction(name, "apply"), [runProfileAction]);
  const deleteProfile = useCallback((name: string) => runProfileAction(name, "delete"), [runProfileAction]);

  // Runs automatically on mount and every time the window selection changes
  // (not just on an explicit button click) - a check across all 6 projects
  // completes in a few seconds, cheap enough to just run whenever the
  // settings page is open rather than needing a manual trigger. Every
  // setState call here lives inside a promise callback (same idiom as
  // usePantryAuth.ts's `refetch().finally(() => setReady(true))`), never
  // synchronously in the callback's own top-level body, the same way this
  // codebase's other fetch-on-mount effects avoid tripping
  // react-hooks/set-state-in-effect.
  const runColdStartCheck = useCallback(() => {
    if (!ENDPOINT) return Promise.resolve();

    return fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "checkColdStarts", windowMinutes: coldStartWindowMinutes }),
    })
      .then((res) => res.json())
      .then((data: { coldStarts: WarmScheduleColdStarts }) => {
        setColdStarts(data.coldStarts);
        setColdStartError(null);
      })
      .catch(() => setColdStartError("Couldn't check cold start rate"));
  }, [coldStartWindowMinutes]);

  useEffect(() => {
    runColdStartCheck().finally(() => setCheckingColdStarts(false));
  }, [runColdStartCheck]);

  return {
    config,
    costs,
    profiles,
    reactive,
    refresh,
    coldStarts,
    checkingColdStarts,
    coldStartWindowMinutes,
    setColdStartWindowMinutes,
    coldStartError,
    saving,
    profilePending,
    error,
    saveAll,
    saveProfile,
    applyProfile,
    deleteProfile,
    available: Boolean(ENDPOINT),
  };
}
