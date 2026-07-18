import { useCallback, useEffect, useState } from "react";

// Unlike useShowAlsoBuilt, this isn't a per-browser preference - it's a
// direct read/write against the zero-trust-lab's WarmupConfigFunction, which
// flips the actual EventBridge Scheduler rules on/off for every visitor.
const ENDPOINT = import.meta.env.VITE_ZERO_TRUST_WARMUP_CONFIG_ENDPOINT;

export function useZeroTrustWarmup() {
  const [enabled, setEnabledState] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ENDPOINT) return;
    fetch(ENDPOINT)
      .then((res) => res.json())
      .then((data: { enabled: boolean }) => setEnabledState(data.enabled))
      .catch(() => setError("Couldn't load warmup status"));
  }, []);

  const setEnabled = useCallback((value: boolean) => {
    if (!ENDPOINT) return;
    setPending(true);
    setError(null);
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: value }),
    })
      .then((res) => res.json())
      .then((data: { enabled: boolean }) => setEnabledState(data.enabled))
      .catch(() => setError("Couldn't update warmup status"))
      .finally(() => setPending(false));
  }, []);

  return { enabled, pending, error, setEnabled, available: Boolean(ENDPOINT) };
}
