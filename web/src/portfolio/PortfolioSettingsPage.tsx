import { useState } from "react";
import { Link } from "react-router-dom";
import { useShowAlsoBuilt } from "./hooks/useShowAlsoBuilt";
import { useShowFooterCost } from "../shared/hooks/useShowFooterCost";
import {
  useWarmSchedule,
  schedulesEqual,
  isScheduleValid,
  COLD_START_WINDOW_OPTIONS,
  type WarmScheduleKey,
  type WarmSchedule,
} from "./hooks/useWarmSchedule";
import { useAlertsEnabled } from "./hooks/useAlertsEnabled";
import { useCollapsedKeys } from "./hooks/useCollapsedKeys";
import WarmScheduleProject from "./components/WarmScheduleProject";
import WarmScheduleProfiles from "./components/WarmScheduleProfiles";
import Footer from "../shared/components/Footer";
import "./portfolio.css";

const WARM_SCHEDULE_LABELS: Record<WarmScheduleKey, string> = {
  portfolio: "portfolio",
  pantry: "pantry",
  imposter: "imposter",
  supergraph: "supergraph",
  designStudio: "design-studio",
  zeroTrustLab: "zero-trust-lab (no real visitors - only speeds up your own testing of it)",
};
const WARM_SCHEDULE_KEYS = Object.keys(WARM_SCHEDULE_LABELS) as WarmScheduleKey[];

export default function PortfolioSettingsPage() {
  const { showAlsoBuilt, setShowAlsoBuilt } = useShowAlsoBuilt();
  const { showFooterCost, setShowFooterCost } = useShowFooterCost();
  const {
    config: warmScheduleConfig,
    costs: warmScheduleCosts,
    profiles: warmScheduleProfiles,
    reactive: warmScheduleReactive,
    refresh: refreshWarmSchedule,
    coldStarts: warmScheduleColdStarts,
    checkingColdStarts,
    coldStartWindowMinutes,
    setColdStartWindowMinutes,
    coldStartError,
    saving: warmScheduleSaving,
    profilePending: warmScheduleProfilePending,
    error: warmScheduleError,
    saveAll: saveAllWarmSchedules,
    saveProfile: saveWarmScheduleProfile,
    applyProfile: applyWarmScheduleProfile,
    deleteProfile: deleteWarmScheduleProfile,
    available: warmScheduleAvailable,
  } = useWarmSchedule();
  const coldStartWindowLabel =
    COLD_START_WINDOW_OPTIONS.find((option) => option.minutes === coldStartWindowMinutes)?.label ?? "";
  // Every project's draft lives here (not inside each WarmScheduleProject
  // row) so a single "Save all" button can see every row's unsaved edits at
  // once. Reset from `config` whenever it gets a fresh object reference -
  // that only happens on initial load and right after saveAll resolves, so
  // this never clobbers an in-progress edit mid-typing.
  const [warmScheduleDrafts, setWarmScheduleDrafts] = useState(warmScheduleConfig);
  const [prevWarmScheduleConfig, setPrevWarmScheduleConfig] = useState(warmScheduleConfig);
  if (warmScheduleConfig !== prevWarmScheduleConfig) {
    setPrevWarmScheduleConfig(warmScheduleConfig);
    setWarmScheduleDrafts(warmScheduleConfig);
  }

  const dirtyWarmSchedules: Partial<Record<WarmScheduleKey, WarmSchedule>> =
    warmScheduleDrafts && warmScheduleConfig
      ? Object.fromEntries(
          WARM_SCHEDULE_KEYS.filter(
            (fn) => !schedulesEqual(warmScheduleDrafts[fn], warmScheduleConfig[fn])
          ).map((fn) => [fn, warmScheduleDrafts[fn]])
        )
      : {};
  const hasDirtyWarmSchedules = Object.keys(dirtyWarmSchedules).length > 0;
  const hasInvalidWarmSchedule = warmScheduleDrafts
    ? WARM_SCHEDULE_KEYS.some((fn) => !isScheduleValid(warmScheduleDrafts[fn]))
    : false;
  const totalScheduledMonthlyCostUsd = warmScheduleCosts
    ? WARM_SCHEDULE_KEYS.reduce((sum, fn) => sum + warmScheduleCosts[fn].scheduledMonthlyCostUsd, 0)
    : 0;
  const totalLast24hCostUsd = warmScheduleCosts
    ? WARM_SCHEDULE_KEYS.reduce((sum, fn) => sum + warmScheduleCosts[fn].last24hCostUsd, 0)
    : 0;
  const {
    enabled: alertsEnabled,
    pending: alertsPending,
    error: alertsError,
    setEnabled: setAlertsEnabled,
    available: alertsAvailable,
  } = useAlertsEnabled();
  // In-memory only (same as ExperienceSection/EducationSection's own use of
  // this hook) - keyed by each project's stable `fn` key, so Save/Refresh/
  // profile actions (which replace warmScheduleConfig/Drafts with a fresh
  // object) never reset which rows are expanded, since this state lives
  // independently of that data.
  const { isCollapsed: isWarmScheduleCollapsed, toggle: toggleWarmScheduleCollapsed } = useCollapsedKeys();

  return (
    <>
      <header className="page-head">
        <p className="eyebrow">preferences</p>
        <h1>Settings</h1>
      </header>

      <div className="form-row">
        <label className="form-label form-checkbox-label" htmlFor="show-also-built">
          <input
            id="show-also-built"
            type="checkbox"
            checked={showAlsoBuilt}
            onChange={(e) => setShowAlsoBuilt(e.target.checked)}
          />{" "}
          Show &quot;also built imposter, pantry, and design-studio&quot; note on home page
        </label>
      </div>

      <div className="form-row">
        <label className="form-label form-checkbox-label" htmlFor="show-footer-cost">
          <input
            id="show-footer-cost"
            type="checkbox"
            checked={showFooterCost}
            onChange={(e) => setShowFooterCost(e.target.checked)}
          />{" "}
          Show real AWS/Anthropic cost since launch in the footer (AWS side is within the $200 AWS Free Tier
          credit)
        </label>
      </div>

      {alertsAvailable && (
        <div className="form-row">
          <label className="form-label form-checkbox-label" htmlFor="alerts-enabled">
            <input
              id="alerts-enabled"
              type="checkbox"
              checked={alertsEnabled ?? true}
              disabled={alertsEnabled === null || alertsPending}
              onChange={(e) => setAlertsEnabled(e.target.checked)}
            />{" "}
            Email me when a CloudWatch alarm fires (errors, throttles, or slow p99 duration on any Lambda)
          </label>
          {alertsError && <p className="section-hint">{alertsError}</p>}
        </div>
      )}

      {warmScheduleAvailable && (
        <div className="form-row">
          <p className="form-label">
            Keep warm with provisioned concurrency (Sydney time) - no cold starts for real visitors during the
            window you set below. Prices below are live, from each project's real Lambda memory size and
            currently-allocated provisioned concurrency. Each project can also opt in to warming reactively
            for 1hr after a real cold start - independent of the scheduled window, so it works whether that's
            on or off.
          </p>
          <WarmScheduleProfiles
            profiles={warmScheduleProfiles}
            pending={warmScheduleProfilePending}
            hasUnsavedEdits={hasDirtyWarmSchedules}
            onSave={saveWarmScheduleProfile}
            onApply={applyWarmScheduleProfile}
            onDelete={deleteWarmScheduleProfile}
          />
          <div className="warm-schedule-days" role="group" aria-label="Cold start check window">
            {COLD_START_WINDOW_OPTIONS.map((option) => (
              <button
                key={option.minutes}
                type="button"
                className={`warm-schedule-day-btn${option.minutes === coldStartWindowMinutes ? " active" : ""}`}
                aria-pressed={option.minutes === coldStartWindowMinutes}
                onClick={() => setColdStartWindowMinutes(option.minutes)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="section-hint">
            Cold start rate below is checked automatically, over the window selected above.
            {checkingColdStarts && " Checking…"}
          </p>
          {coldStartError && <p className="section-hint">{coldStartError}</p>}
          {warmScheduleDrafts &&
            WARM_SCHEDULE_KEYS.map((fn) => (
              <WarmScheduleProject
                key={fn}
                fn={fn}
                label={WARM_SCHEDULE_LABELS[fn]}
                draft={warmScheduleDrafts[fn]}
                onChange={(schedule) =>
                  setWarmScheduleDrafts((current) => (current ? { ...current, [fn]: schedule } : current))
                }
                cost={warmScheduleCosts?.[fn]}
                reactiveStatus={warmScheduleReactive?.[fn]}
                coldStart={warmScheduleColdStarts?.[fn]}
                coldStartWindowLabel={coldStartWindowLabel}
                disabled={warmScheduleSaving}
                collapsed={isWarmScheduleCollapsed(fn)}
                onToggleCollapsed={() => toggleWarmScheduleCollapsed(fn)}
              />
            ))}
          {warmScheduleCosts && (
            <p className="section-hint">
              Total: ~${totalScheduledMonthlyCostUsd.toFixed(2)}/mo if all schedules run as set · ~$
              {totalLast24hCostUsd.toFixed(2)} est. across all Lambdas in the last 24h
            </p>
          )}
          <button
            className="run-btn"
            type="button"
            disabled={!hasDirtyWarmSchedules || hasInvalidWarmSchedule || warmScheduleSaving}
            onClick={() => saveAllWarmSchedules(dirtyWarmSchedules)}
          >
            Save all
          </button>{" "}
          <button className="run-btn" type="button" onClick={() => refreshWarmSchedule()}>
            Refresh status
          </button>
          {warmScheduleError && <p className="section-hint">{warmScheduleError}</p>}
        </div>
      )}

      <p className="section-hint">
        <Link to="/">← back home</Link>
      </p>

      <Footer />
    </>
  );
}
