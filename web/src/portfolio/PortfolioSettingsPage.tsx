import { useState } from "react";
import { Link } from "react-router-dom";
import { useShowAlsoBuilt } from "./hooks/useShowAlsoBuilt";
import { useShowFooterCost } from "./hooks/useShowFooterCost";
import { usePageLoadWarmup } from "./hooks/usePageLoadWarmup";
import { useStaggerHomeFetches } from "./hooks/useStaggerHomeFetches";
import {
  useWarmSchedule,
  schedulesEqual,
  isScheduleValid,
  type WarmScheduleKey,
  type WarmSchedule,
} from "./hooks/useWarmSchedule";
import { useAlertsEnabled } from "./hooks/useAlertsEnabled";
import WarmScheduleProject from "./components/WarmScheduleProject";
import WarmScheduleProfiles from "./components/WarmScheduleProfiles";
import "./portfolio.css";

const WARM_SCHEDULE_LABELS: Record<WarmScheduleKey, string> = {
  portfolio: "this resume site",
  pantry: "pantry",
  imposter: "imposter",
  supergraph: "supergraph (GraphQL gateway in front of the three above)",
  designStudio: "design-studio",
  zeroTrustLab: "zero-trust-lab (no real visitors - only speeds up your own testing of it)",
};
const WARM_SCHEDULE_KEYS = Object.keys(WARM_SCHEDULE_LABELS) as WarmScheduleKey[];

export default function PortfolioSettingsPage() {
  const { showAlsoBuilt, setShowAlsoBuilt } = useShowAlsoBuilt();
  const { showFooterCost, setShowFooterCost } = useShowFooterCost();
  const { pageLoadWarmup, setPageLoadWarmup } = usePageLoadWarmup();
  const { staggerHomeFetches, setStaggerHomeFetches } = useStaggerHomeFetches();
  const {
    config: warmScheduleConfig,
    costs: warmScheduleCosts,
    profiles: warmScheduleProfiles,
    saving: warmScheduleSaving,
    profilePending: warmScheduleProfilePending,
    error: warmScheduleError,
    saveAll: saveAllWarmSchedules,
    saveProfile: saveWarmScheduleProfile,
    applyProfile: applyWarmScheduleProfile,
    deleteProfile: deleteWarmScheduleProfile,
    available: warmScheduleAvailable,
  } = useWarmSchedule();
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
  const {
    enabled: alertsEnabled,
    pending: alertsPending,
    error: alertsError,
    setEnabled: setAlertsEnabled,
    available: alertsAvailable,
  } = useAlertsEnabled();

  return (
    <>
      <header className="page-head">
        <p className="eyebrow">preferences</p>
        <h1>Settings</h1>
      </header>

      <div className="form-row">
        <label className="form-label" htmlFor="show-also-built">
          <input
            id="show-also-built"
            type="checkbox"
            checked={showAlsoBuilt}
            onChange={(e) => setShowAlsoBuilt(e.target.checked)}
          />{" "}
          Show &quot;also built imposter and pantry&quot; note on home page
        </label>
      </div>

      <div className="form-row">
        <label className="form-label" htmlFor="show-footer-cost">
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

      <div className="form-row">
        <label className="form-label" htmlFor="page-load-warmup">
          <input
            id="page-load-warmup"
            type="checkbox"
            checked={pageLoadWarmup}
            onChange={(e) => setPageLoadWarmup(e.target.checked)}
          />{" "}
          Warm pantry/imposter on page load (tighter timing, only helps this browser)
        </label>
      </div>

      <div className="form-row">
        <label className="form-label" htmlFor="stagger-home-fetches">
          <input
            id="stagger-home-fetches"
            type="checkbox"
            checked={staggerHomeFetches}
            onChange={(e) => setStaggerHomeFetches(e.target.checked)}
          />{" "}
          Delay footer/stats queries slightly on home page load so Hero&apos;s query wins the warm Lambda slot
          (only helps this browser)
        </label>
      </div>

      {alertsAvailable && (
        <div className="form-row">
          <label className="form-label" htmlFor="alerts-enabled">
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
            currently-allocated provisioned concurrency.
          </p>
          <WarmScheduleProfiles
            profiles={warmScheduleProfiles}
            pending={warmScheduleProfilePending}
            hasUnsavedEdits={hasDirtyWarmSchedules}
            onSave={saveWarmScheduleProfile}
            onApply={applyWarmScheduleProfile}
            onDelete={deleteWarmScheduleProfile}
          />

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
                disabled={warmScheduleSaving}
              />
            ))}
          {warmScheduleCosts && (
            <p className="section-hint">
              Total: ~${totalScheduledMonthlyCostUsd.toFixed(2)}/mo if all schedules run as set
            </p>
          )}
          <button
            className="run-btn"
            type="button"
            disabled={!hasDirtyWarmSchedules || hasInvalidWarmSchedule || warmScheduleSaving}
            onClick={() => saveAllWarmSchedules(dirtyWarmSchedules)}
          >
            Save all
          </button>
          {warmScheduleError && <p className="section-hint">{warmScheduleError}</p>}
        </div>
      )}

      <p className="section-hint">
        <Link to="/">← back home</Link>
      </p>
    </>
  );
}
