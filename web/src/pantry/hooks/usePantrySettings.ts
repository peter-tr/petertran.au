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

// PantrySettingsInput's fields are all schema-nullable (see schema.graphql -
// every field is e.g. `view: String`, not `view: String!`), even though
// PantrySettings itself never actually returns null for most of them. Every
// real caller in this codebase only ever passes concrete values, never
// explicit null, so an optimistic merge can safely skip any (never-sent-in-
// practice) null/undefined key rather than letting it null out a
// non-nullable PantrySettings field.
// Exported for usePantryHome, which needs the identical optimistic-merge
// behavior for its own updateSettings.
export function mergeSettings(prev: PantrySettings, partial: PantrySettingsInput): PantrySettings {
  const next = { ...prev };
  for (const key of Object.keys(partial) as (keyof PantrySettingsInput)[]) {
    const value = partial[key];
    if (value !== null && value !== undefined) {
      (next as Record<string, unknown>)[key] = value;
    }
  }
  return next;
}

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
    setSettings((prev) => (prev ? mergeSettings(prev, partial) : prev));
    runPantryQuery<UpdateSettingsResult>(UPDATE_SETTINGS_MUTATION, { input: partial }).catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    });
  }, []);

  return { settings, error, updateSettings };
}
