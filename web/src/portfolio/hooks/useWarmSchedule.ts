import { useCallback, useEffect, useState } from "react";

// Direct read/write against ProvisionedConcurrencyStack's WarmScheduleFunction -
// same "not a per-browser preference" reasoning as the old warmup schedule
// toggle: this flips real Provisioned Concurrency for every visitor, per
// project (portfolio/pantry/imposter/supergraph), on the days/times its own
// schedule says. zeroTrustLab is the one exception - it has no real visitors,
// so its schedule only affects how snappy your own manual testing of that lab
// feels.
const ENDPOINT = import.meta.env.VITE_WARM_SCHEDULE_ENDPOINT;

export type WarmScheduleKey = "portfolio" | "pantry" | "imposter" | "supergraph" | "zeroTrustLab";
export type Weekday = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";

export interface WarmSchedule {
  enabled: boolean;
  days: Weekday[];
  start: string; // "HH:MM", 24h, Sydney-local
  end: string; // "HH:MM"
}

export type WarmScheduleConfig = Record<WarmScheduleKey, WarmSchedule>;

export function useWarmSchedule() {
  const [config, setConfigState] = useState<WarmScheduleConfig | null>(null);
  // The project currently being saved, not a single shared flag - a save in
  // flight for one project shouldn't disable every other project's Save
  // button too.
  const [pendingFn, setPendingFn] = useState<WarmScheduleKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ENDPOINT) return;
    fetch(ENDPOINT)
      .then((res) => res.json())
      .then((data: WarmScheduleConfig) => setConfigState(data))
      .catch(() => setError("Couldn't load provisioned concurrency status"));
  }, []);

  const setSchedule = useCallback((fn: WarmScheduleKey, schedule: WarmSchedule) => {
    if (!ENDPOINT) return;
    setPendingFn(fn);
    setError(null);
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: fn, schedule }),
    })
      .then((res) => res.json())
      .then((data: WarmScheduleConfig) =>
        // Only replace the saved project's entry, not the whole config - a
        // fresh object reference for every project (even ones nothing
        // changed for) would otherwise reset every other row's in-progress
        // draft too (see WarmScheduleProject's schedulesEqual-based reset
        // check, which this keeps working correctly for untouched rows).
        setConfigState((current) => (current ? { ...current, [fn]: data[fn] } : data))
      )
      .catch(() => setError("Couldn't update provisioned concurrency status"))
      .finally(() => setPendingFn(null));
  }, []);

  return { config, pendingFn, error, setSchedule, available: Boolean(ENDPOINT) };
}
