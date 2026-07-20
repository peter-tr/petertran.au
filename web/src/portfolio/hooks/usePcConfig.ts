import { useCallback, useEffect, useState } from "react";

// Direct read/write against ProvisionedConcurrencyStack's PcConfigFunction -
// same "not a per-browser preference" reasoning as the old warmup schedule
// toggle: this flips real Provisioned Concurrency for every visitor, per
// project (portfolio/pantry/imposter), on the days/times its own schedule
// says. zeroTrustLab is the one exception - it has no real visitors, so its
// schedule only affects how snappy your own manual testing of that lab feels.
const ENDPOINT = import.meta.env.VITE_PC_CONFIG_ENDPOINT;

export type PcFunctionKey = "portfolio" | "pantry" | "imposter" | "zeroTrustLab";
export type Weekday = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";

export interface PcSchedule {
  enabled: boolean;
  days: Weekday[];
  start: string; // "HH:MM", 24h, Sydney-local
  end: string; // "HH:MM"
}

export type PcConfig = Record<PcFunctionKey, PcSchedule>;

export function usePcConfig() {
  const [config, setConfigState] = useState<PcConfig | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ENDPOINT) return;
    fetch(ENDPOINT)
      .then((res) => res.json())
      .then((data: PcConfig) => setConfigState(data))
      .catch(() => setError("Couldn't load provisioned concurrency status"));
  }, []);

  const setSchedule = useCallback((fn: PcFunctionKey, schedule: PcSchedule) => {
    if (!ENDPOINT) return;
    setPending(true);
    setError(null);
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: fn, schedule }),
    })
      .then((res) => res.json())
      .then((data: PcConfig) => setConfigState(data))
      .catch(() => setError("Couldn't update provisioned concurrency status"))
      .finally(() => setPending(false));
  }, []);

  return { config, pending, error, setSchedule, available: Boolean(ENDPOINT) };
}
