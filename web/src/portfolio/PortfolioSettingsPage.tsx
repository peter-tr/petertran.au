import { Link } from "react-router-dom";
import { useShowAlsoBuilt } from "./hooks/useShowAlsoBuilt";
import { useWarmupSchedule } from "./hooks/useWarmupSchedule";
import { usePageLoadWarmup } from "./hooks/usePageLoadWarmup";
import "./portfolio.css";

export default function PortfolioSettingsPage() {
  const { showAlsoBuilt, setShowAlsoBuilt } = useShowAlsoBuilt();
  const {
    enabled: scheduleEnabled,
    pending: schedulePending,
    error: scheduleError,
    setEnabled: setScheduleEnabled,
    available: scheduleAvailable,
  } = useWarmupSchedule();
  const { pageLoadWarmup, setPageLoadWarmup } = usePageLoadWarmup();

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

      {scheduleAvailable && (
        <div className="form-row">
          <label className="form-label" htmlFor="warmup-schedule">
            <input
              id="warmup-schedule"
              type="checkbox"
              checked={scheduleEnabled ?? false}
              disabled={scheduleEnabled === null || schedulePending}
              onChange={(e) => setScheduleEnabled(e.target.checked)}
            />{" "}
            Keep the site's Lambdas warm on a schedule (pings every 10 minutes, cheaper, helps every visitor)
          </label>
          {scheduleError && <p className="section-hint">{scheduleError}</p>}
        </div>
      )}

      <p className="section-hint">
        <Link to="/">← back home</Link>
      </p>
    </>
  );
}
