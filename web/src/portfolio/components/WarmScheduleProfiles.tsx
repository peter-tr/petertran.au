import { useState } from "react";
import type { WarmScheduleProfiles as WarmScheduleProfilesMap } from "../hooks/useWarmSchedule";

interface WarmScheduleProfilesProps {
  profiles: WarmScheduleProfilesMap | null;
  pending: string | null;
  // True while any project row has an unsaved edit (see
  // PortfolioSettingsPage's hasDirtyWarmSchedules) - "save" snapshots the
  // last-*persisted* config (what the server/EventBridge schedules actually
  // reflect right now), not the on-screen draft, so saving a profile while
  // edits are pending would silently snapshot the stale, pre-edit state.
  // Blocked with a hint instead, pointing at "Save all" first.
  hasUnsavedEdits: boolean;
  onSave: (name: string) => void;
  onApply: (name: string) => void;
  onDelete: (name: string) => void;
}

// Save/apply/delete a named snapshot of every project's schedule at once
// (e.g. "all cold, 1024MB") - sits above the per-project WarmScheduleProject
// rows on the settings page. Each action posts straight through
// useWarmSchedule's saveProfile/applyProfile/deleteProfile, so there's no
// local draft state here beyond the name being typed for a new save.
export default function WarmScheduleProfiles({
  profiles,
  pending,
  hasUnsavedEdits,
  onSave,
  onApply,
  onDelete,
}: Readonly<WarmScheduleProfilesProps>) {
  const [name, setName] = useState("");
  const trimmedName = name.trim();
  const busy = pending !== null;
  const profileNames = profiles ? Object.keys(profiles).sort((a, b) => a.localeCompare(b)) : [];

  function handleSave(): void {
    onSave(trimmedName);
    setName("");
  }

  return (
    <div className="warm-schedule-profiles">
      <p className="form-label">
        Profiles - save the current setup for every project above, or apply one back
      </p>

      {profileNames.length > 0 && (
        <ul className="warm-schedule-profiles-list">
          {profileNames.map((profileName) => (
            <li key={profileName} className="warm-schedule-profile-row">
              <span className="warm-schedule-profile-name">{profileName}</span>
              <button type="button" className="run-btn" disabled={busy} onClick={() => onApply(profileName)}>
                {pending === profileName ? "…" : "Apply"}
              </button>
              <button type="button" className="run-btn" disabled={busy} onClick={() => onDelete(profileName)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="warm-schedule-profile-save">
        <input
          className="form-input"
          type="text"
          placeholder="Profile name"
          aria-label="New profile name"
          value={name}
          disabled={busy || hasUnsavedEdits}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          className="run-btn"
          disabled={busy || hasUnsavedEdits || trimmedName.length === 0}
          onClick={handleSave}
        >
          Save current as profile
        </button>
      </div>
      {hasUnsavedEdits ? (
        <p className="section-hint">Save all pending edits above before saving a new profile.</p>
      ) : (
        profileNames.includes(trimmedName) && (
          <p className="section-hint">
            Saving will overwrite the existing &quot;{trimmedName}&quot; profile.
          </p>
        )
      )}
    </div>
  );
}
