import { useCallback, useEffect, useState } from "react";
import {
  runPantryQuery,
  SETTINGS_QUERY,
  UPDATE_SETTINGS_MUTATION,
  type PantrySettings,
  type PantrySettingsInput,
  type SettingsQueryResult,
  type UpdateSettingsResult,
} from "../api";

export function usePantrySettings() {
  const [settings, setSettings] = useState<PantrySettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    runPantryQuery<SettingsQueryResult>(SETTINGS_QUERY)
      .then((res) => setSettings(res.settings))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, []);

  // Applies immediately (so the UI feels instant) and persists in the
  // background - these are shared, low-stakes view preferences, not data
  // that needs a round trip before the screen updates.
  const updateSettings = useCallback((partial: PantrySettingsInput) => {
    setSettings((prev) => (prev ? { ...prev, ...partial } : prev));
    runPantryQuery<UpdateSettingsResult>(UPDATE_SETTINGS_MUTATION, { input: partial }).catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    });
  }, []);

  return { settings, error, updateSettings };
}
