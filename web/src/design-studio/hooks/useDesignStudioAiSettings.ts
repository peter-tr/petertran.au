import { useCallback, useEffect, useState } from "react";
import { getAiSettings, updateAiSettings, type AiSettings, type AiSettingsInput } from "../api";

// Every real caller only ever passes concrete values, never explicit null -
// same reasoning as pantry's usePantrySettings.mergeSettings, which this
// mirrors: skip any (never-sent-in-practice) null/undefined key rather than
// letting it null out a non-nullable AiSettings field.
export function mergeAiSettings(prev: AiSettings, partial: AiSettingsInput): AiSettings {
  const next = { ...prev };
  for (const key of Object.keys(partial) as (keyof AiSettingsInput)[]) {
    const value = partial[key];
    if (value !== null && value !== undefined) {
      (next as Record<string, unknown>)[key] = value;
    }
  }

  return next;
}

export function useDesignStudioAiSettings() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAiSettings()
      .then(setSettings)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, []);

  // Applies immediately (so the UI feels instant) and persists in the
  // background - same low-stakes-setting reasoning as usePantrySettings.
  const updateSettings = useCallback((partial: AiSettingsInput) => {
    setSettings((prev) => (prev ? mergeAiSettings(prev, partial) : prev));
    updateAiSettings(partial).catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    });
  }, []);

  return { settings, error, updateSettings };
}
