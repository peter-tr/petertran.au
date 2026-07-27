import {
  MAX_CONCURRENCY,
  MEMORY_OPTIONS_MB,
  isScheduleValid,
  type WarmScheduleKey,
  type WarmSchedule,
  type Weekday,
  type ProjectCost,
  type ColdStartStats,
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

interface WarmScheduleProjectProps {
  fn: WarmScheduleKey;
  label: string;
  draft: WarmSchedule;
  onChange: (schedule: WarmSchedule) => void;
  cost: ProjectCost | undefined;
  coldStart: ColdStartStats | undefined;
  disabled: boolean;
}

// One project's day/time editor - a controlled component whose `draft`
// state lives in PortfolioSettingsPage, so a single "Save all" button
// there can POST every dirty project's schedule at once instead of each
// row round-tripping its own save.
export default function WarmScheduleProject({
  fn,
  label,
  draft,
  onChange,
  cost,
  coldStart,
  disabled,
}: WarmScheduleProjectProps) {
  function toggleDay(day: Weekday): void {
    onChange({
      ...draft,
      days: draft.days.includes(day)
        ? draft.days.filter((existing) => existing !== day)
        : [...draft.days, day],
    });
  }

  const invalid = !isScheduleValid(draft);

  return (
    <div className="warm-schedule">
      <label className="form-label" htmlFor={`warm-schedule-${fn}-enabled`}>
        <input
          id={`warm-schedule-${fn}-enabled`}
          type="checkbox"
          checked={draft.enabled}
          disabled={disabled}
          onChange={(e) => onChange({ ...draft, enabled: e.target.checked })}
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
            disabled={disabled}
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
          disabled={disabled}
          onChange={(e) => onChange({ ...draft, start: e.target.value })}
        />
        <span className="warm-schedule-times-sep">to</span>
        <input
          className="form-input"
          type="time"
          aria-label={`${label} end time`}
          value={draft.end}
          disabled={disabled}
          onChange={(e) => onChange({ ...draft, end: e.target.value })}
        />
        <span className="warm-schedule-times-sep">×</span>
        <input
          className="form-input warm-schedule-concurrency-input"
          type="number"
          min={1}
          max={MAX_CONCURRENCY}
          aria-label={`${label} provisioned concurrency`}
          value={draft.concurrency}
          disabled={disabled}
          onChange={(e) => onChange({ ...draft, concurrency: Number(e.target.value) })}
        />
        <span className="warm-schedule-times-sep">@</span>
        <select
          className="form-input"
          aria-label={`${label} memory size`}
          value={draft.memoryMb}
          disabled={disabled}
          onChange={(e) => onChange({ ...draft, memoryMb: Number(e.target.value) })}
        >
          {MEMORY_OPTIONS_MB.map((mb) => (
            <option key={mb} value={mb}>
              {mb}MB
            </option>
          ))}
        </select>
      </div>
      {cost && (
        <p className="section-hint">
          {cost.liveConcurrency > 0
            ? `Currently ${cost.liveConcurrency} warm instance${cost.liveConcurrency === 1 ? "" : "s"} ($${cost.liveHourlyCostUsd.toFixed(4)}/hr)`
            : "Currently cold (no PC active)"}{" "}
          · ~${cost.scheduledMonthlyCostUsd.toFixed(2)}/mo if this schedule runs as set
        </p>
      )}
      {coldStart &&
        (coldStart.error ? (
          <p className="section-hint">Cold start check failed: {coldStart.error}</p>
        ) : (
          <p className="section-hint">
            Last 24h: {coldStart.coldStartPercent}% cold starts ({coldStart.coldStartCount} of{" "}
            {coldStart.totalInvocations} invocations)
          </p>
        ))}
      {invalid && (
        <p className="section-hint">
          Pick at least one day, with start before end, concurrency between 1 and {MAX_CONCURRENCY}, and a
          valid memory size.
        </p>
      )}
    </div>
  );
}
