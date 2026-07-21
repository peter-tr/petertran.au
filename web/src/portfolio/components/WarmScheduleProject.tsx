import { useState } from "react";
import {
  MAX_CONCURRENCY,
  type WarmScheduleKey,
  type WarmSchedule,
  type Weekday,
} from "../hooks/useWarmSchedule";

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

function schedulesEqual(a: WarmSchedule, b: WarmSchedule): boolean {
  return (
    a.enabled === b.enabled &&
    a.start === b.start &&
    a.end === b.end &&
    a.concurrency === b.concurrency &&
    a.days.length === b.days.length &&
    a.days.every((d) => b.days.includes(d))
  );
}

interface WarmScheduleProjectProps {
  fn: WarmScheduleKey;
  label: string;
  schedule: WarmSchedule;
  pending: boolean;
  onSave: (schedule: WarmSchedule) => void;
}

// One project's day/time editor - edits stay in local `draft` state until
// "Save" is clicked, so toggling a day or nudging a time input doesn't fire
// a request (and an UpdateScheduleCommand pair) per keystroke.
export default function WarmScheduleProject({
  fn,
  label,
  schedule,
  pending,
  onSave,
}: WarmScheduleProjectProps) {
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
  const invalid =
    draft.enabled &&
    (draft.days.length === 0 ||
      draft.start >= draft.end ||
      !Number.isInteger(draft.concurrency) ||
      draft.concurrency < 1 ||
      draft.concurrency > MAX_CONCURRENCY);

  return (
    <div className="warm-schedule">
      <label className="form-label" htmlFor={`warm-schedule-${fn}-enabled`}>
        <input
          id={`warm-schedule-${fn}-enabled`}
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
        />{" "}
        {label}
      </label>

      <div className="warm-schedule-days">
        {ALL_DAYS.map((day) => (
          <button
            key={day}
            type="button"
            className={`warm-schedule-day-btn${draft.days.includes(day) ? " active" : ""}`}
            aria-pressed={draft.days.includes(day)}
            onClick={() => toggleDay(day)}
          >
            {DAY_LABELS[day]}
          </button>
        ))}
      </div>

      <div className="warm-schedule-times">
        <input
          className="form-input"
          type="time"
          aria-label={`${label} start time`}
          value={draft.start}
          onChange={(e) => setDraft((d) => ({ ...d, start: e.target.value }))}
        />
        <span className="warm-schedule-times-sep">to</span>
        <input
          className="form-input"
          type="time"
          aria-label={`${label} end time`}
          value={draft.end}
          onChange={(e) => setDraft((d) => ({ ...d, end: e.target.value }))}
        />
        <span className="warm-schedule-times-sep">×</span>
        <input
          className="form-input warm-schedule-concurrency-input"
          type="number"
          min={1}
          max={MAX_CONCURRENCY}
          aria-label={`${label} provisioned concurrency`}
          value={draft.concurrency}
          onChange={(e) => setDraft((d) => ({ ...d, concurrency: Number(e.target.value) }))}
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
      {invalid && (
        <p className="section-hint">
          Pick at least one day, with start before end, and concurrency between 1 and {MAX_CONCURRENCY}.
        </p>
      )}
    </div>
  );
}
