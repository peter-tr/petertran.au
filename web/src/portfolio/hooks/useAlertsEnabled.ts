import { useCallback, useEffect, useState } from "react";

// Direct read/write against MonitoringStack's AlertsSettingsFunction - same
// "not a per-browser preference" reasoning as useWarmSchedule: this mutes/
// unmutes the one shared CloudWatch alarm -> SNS -> email subscription for
// everyone who visits Settings, not just this browser.
const ENDPOINT = import.meta.env.VITE_ALERTS_SETTINGS_ENDPOINT;

export function useAlertsEnabled() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ENDPOINT) return;
    fetch(ENDPOINT)
      .then((res) => res.json())
      .then((data: { enabled: boolean }) => setEnabled(data.enabled))
      .catch(() => setError("Couldn't load alert email status"));
  }, []);

  // Wraps the plain state setter with the POST round-trip, and is what
  // callers get as `setEnabled`.
  const updateEnabled = useCallback((value: boolean) => {
    if (!ENDPOINT) return;
    setPending(true);
    setError(null);
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: value }),
    })
      .then((res) => res.json())
      .then((data: { enabled: boolean }) => setEnabled(data.enabled))
      .catch(() => setError("Couldn't update alert email status"))
      .finally(() => setPending(false));
  }, []);

  return { enabled, pending, error, setEnabled: updateEnabled, available: Boolean(ENDPOINT) };
}
