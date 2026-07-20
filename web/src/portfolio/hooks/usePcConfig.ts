import { useCallback, useEffect, useState } from "react";

// Direct read/write against ProvisionedConcurrencyStack's PcConfigFunction -
// same "not a per-browser preference" reasoning as useWarmupSchedule: this
// flips real Provisioned Concurrency for every visitor, per function
// (portfolio/pantry/imposter), 8am-7pm Sydney while its flag is on.
// zeroTrustLab is the one exception - it has no real visitors, so its flag
// only affects how snappy your own manual testing of that lab feels.
const ENDPOINT = import.meta.env.VITE_PC_CONFIG_ENDPOINT;

export type PcFunctionKey = "portfolio" | "pantry" | "imposter" | "zeroTrustLab";
export type PcFlags = Record<PcFunctionKey, boolean>;

export function usePcConfig() {
  const [flags, setFlagsState] = useState<PcFlags | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ENDPOINT) return;
    fetch(ENDPOINT)
      .then((res) => res.json())
      .then((data: PcFlags) => setFlagsState(data))
      .catch(() => setError("Couldn't load provisioned concurrency status"));
  }, []);

  const setEnabled = useCallback((fn: PcFunctionKey, value: boolean) => {
    if (!ENDPOINT) return;
    setPending(true);
    setError(null);
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ function: fn, enabled: value }),
    })
      .then((res) => res.json())
      .then((data: PcFlags) => setFlagsState(data))
      .catch(() => setError("Couldn't update provisioned concurrency status"))
      .finally(() => setPending(false));
  }, []);

  return { flags, pending, error, setEnabled, available: Boolean(ENDPOINT) };
}
