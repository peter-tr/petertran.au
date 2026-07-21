import { Link } from "react-router-dom";
import { useShowAlsoBuilt } from "./hooks/useShowAlsoBuilt";
import { usePageLoadWarmup } from "./hooks/usePageLoadWarmup";
import { useWarmSchedule, type WarmScheduleKey } from "./hooks/useWarmSchedule";
import { useAlertsEnabled } from "./hooks/useAlertsEnabled";
import WarmScheduleProject from "./components/WarmScheduleProject";
import "./portfolio.css";

const WARM_SCHEDULE_LABELS: Record<WarmScheduleKey, string> = {
  portfolio: "this resume site",
  pantry: "pantry",
  imposter: "imposter",
  supergraph: "supergraph (GraphQL gateway in front of the three above)",
  zeroTrustLab: "zero-trust-lab (no real visitors - only speeds up your own testing of it)",
};

export default function PortfolioSettingsPage() {
  const { showAlsoBuilt, setShowAlsoBuilt } = useShowAlsoBuilt();
  const { pageLoadWarmup, setPageLoadWarmup } = usePageLoadWarmup();
  const {
    config: warmScheduleConfig,
    pendingFn: warmSchedulePendingFn,
    error: warmScheduleError,
    setSchedule: setWarmSchedule,
    available: warmScheduleAvailable,
  } = useWarmSchedule();
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
            window you set below, ~$1.58/mo each at 11h/day, 256MB
          </p>
          {warmScheduleConfig &&
            (Object.keys(WARM_SCHEDULE_LABELS) as WarmScheduleKey[]).map((fn) => (
              <WarmScheduleProject
                key={fn}
                fn={fn}
                label={WARM_SCHEDULE_LABELS[fn]}
                schedule={warmScheduleConfig[fn]}
                pending={warmSchedulePendingFn === fn}
                onSave={(schedule) => setWarmSchedule(fn, schedule)}
              />
            ))}
          {warmScheduleError && <p className="section-hint">{warmScheduleError}</p>}
        </div>
      )}

      <p className="section-hint">
        <Link to="/">← back home</Link>
      </p>
    </>
  );
}
