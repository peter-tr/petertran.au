import { Link } from "react-router-dom";
import { useShowAlsoBuilt } from "./hooks/useShowAlsoBuilt";
import { useWarmupSchedule } from "./hooks/useWarmupSchedule";
import { usePageLoadWarmup } from "./hooks/usePageLoadWarmup";
import { usePcConfig, type PcFunctionKey } from "./hooks/usePcConfig";
import "./portfolio.css";

const PC_FUNCTION_LABELS: Record<PcFunctionKey, string> = {
  portfolio: "this resume site",
  pantry: "pantry",
  imposter: "imposter",
  zeroTrustLab: "zero-trust-lab (no real visitors - only speeds up your own testing of it)",
};

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
  const {
    flags: pcFlags,
    pending: pcPending,
    error: pcError,
    setEnabled: setPcEnabled,
    available: pcAvailable,
  } = usePcConfig();

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

      {pcAvailable && (
        <div className="form-row">
          <p className="form-label">
            Keep warm 8am-7pm (Sydney) with provisioned concurrency - no cold starts for real visitors during
            those hours, ~$1.58/mo each
          </p>
          {(Object.keys(PC_FUNCTION_LABELS) as PcFunctionKey[]).map((fn) => (
            <label className="form-label" htmlFor={`pc-${fn}`} key={fn}>
              <input
                id={`pc-${fn}`}
                type="checkbox"
                checked={pcFlags?.[fn] ?? false}
                disabled={pcFlags === null || pcPending}
                onChange={(e) => setPcEnabled(fn, e.target.checked)}
              />{" "}
              {PC_FUNCTION_LABELS[fn]}
            </label>
          ))}
          {pcError && <p className="section-hint">{pcError}</p>}
        </div>
      )}

      <p className="section-hint">
        <Link to="/">← back home</Link>
      </p>
    </>
  );
}
