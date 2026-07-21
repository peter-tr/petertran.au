import { Link } from "react-router-dom";
import { useShowAlsoBuilt } from "./hooks/useShowAlsoBuilt";
import { usePageLoadWarmup } from "./hooks/usePageLoadWarmup";
import { useWarmSchedule, type WarmScheduleKey } from "./hooks/useWarmSchedule";
import WarmScheduleProject from "./components/WarmScheduleProject";
import "./portfolio.css";

const WARM_SCHEDULE_LABELS: Record<WarmScheduleKey, string> = {
  portfolio: "this resume site",
  pantry: "pantry",
  imposter: "imposter",
  zeroTrustLab: "zero-trust-lab (no real visitors - only speeds up your own testing of it)",
};

export default function PortfolioSettingsPage() {
  const { showAlsoBuilt, setShowAlsoBuilt } = useShowAlsoBuilt();
  const { pageLoadWarmup, setPageLoadWarmup } = usePageLoadWarmup();
  const {
    config: warmScheduleConfig,
    pending: warmSchedulePending,
    error: warmScheduleError,
    setSchedule: setWarmSchedule,
    available: warmScheduleAvailable,
  } = useWarmSchedule();

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
                pending={warmSchedulePending}
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
