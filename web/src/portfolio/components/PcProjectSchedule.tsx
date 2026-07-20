import { useState } from "react";
import type { PcFunctionKey, PcSchedule, Weekday } from "../hooks/usePcConfig";

const ALL_DAYS: Weekday[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const DAY_LABELS: Record<Weekday, string> = {
  MON: "Mon",
  TUE: "Tue",
  WED: "Wed",
  THU: "Thu",
  FRI: "Fri",
  SAT: "Sat",
  SUN: "Sun",
};

function schedulesEqual(a: PcSchedule, b: PcSchedule): boolean {
  return (
    a.enabled === b.enabled &&
    a.start === b.start &&
    a.end === b.end &&
    a.days.length === b.days.length &&
    a.days.every((d) => b.days.includes(d))
  );
}

interface PcProjectScheduleProps {
  fn: PcFunctionKey;
  label: string;
  schedule: PcSchedule;
  pending: boolean;
  onSave: (schedule: PcSchedule) => void;
}

// One project's day/time editor - edits stay in local `draft` state until
// "Save" is clicked, so toggling a day or nudging a time input doesn't fire
// a request (and an UpdateScheduleCommand pair) per keystroke.
export default function PcProjectSchedule({ fn, label, schedule, pending, onSave }: PcProjectScheduleProps) {
  const [draft, setDraft] = useState(schedule);
  // Tracks the last `schedule` prop seen, so a change to it (e.g. after a
  // fetch/reload) resets the local draft - adjusted during render rather
  // than in an effect, per React's guidance against setState-in-effect
  // cascading an extra render.
  const [prevSchedule, setPrevSchedule] = useState(schedule);
  if (schedule !== prevSchedule) {
    setPrevSchedule(schedule);
    setDraft(schedule);
  }

  function toggleDay(day: Weekday): void {
    setDraft((d) => ({
      ...d,
      days: d.days.includes(day) ? d.days.filter((existing) => existing !== day) : [...d.days, day],
    }));
  }

  const dirty = !schedulesEqual(draft, schedule);
  const invalid = draft.enabled && (draft.days.length === 0 || draft.start >= draft.end);

  return (
    <div className="pc-schedule">
      <label className="form-label" htmlFor={`pc-${fn}-enabled`}>
        <input
          id={`pc-${fn}-enabled`}
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
        />{" "}
        {label}
      </label>

      <div className="pc-days">
        {ALL_DAYS.map((day) => (
          <button
            key={day}
            type="button"
            className={`pc-day-btn${draft.days.includes(day) ? " active" : ""}`}
            aria-pressed={draft.days.includes(day)}
            onClick={() => toggleDay(day)}
          >
            {DAY_LABELS[day]}
          </button>
        ))}
      </div>

      <div className="pc-times">
        <input
          className="form-input"
          type="time"
          aria-label={`${label} start time`}
          value={draft.start}
          onChange={(e) => setDraft((d) => ({ ...d, start: e.target.value }))}
        />
        <span className="pc-times-sep">to</span>
        <input
          className="form-input"
          type="time"
          aria-label={`${label} end time`}
          value={draft.end}
          onChange={(e) => setDraft((d) => ({ ...d, end: e.target.value }))}
        />
        <button
          className="run-btn"
          type="button"
          disabled={!dirty || invalid || pending}
          onClick={() => onSave(draft)}
        >
          Save
        </button>
      </div>
      {invalid && <p className="section-hint">Pick at least one day, with start before end.</p>}
    </div>
  );
}
