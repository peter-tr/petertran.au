import { Link } from "react-router-dom";
import { useShowAlsoBuilt } from "./hooks/useShowAlsoBuilt";
import { usePageLoadWarmup } from "./hooks/usePageLoadWarmup";
import { usePcConfig, type PcFunctionKey } from "./hooks/usePcConfig";
import PcProjectSchedule from "./components/PcProjectSchedule";
import "./portfolio.css";

const PC_FUNCTION_LABELS: Record<PcFunctionKey, string> = {
  portfolio: "this resume site",
  pantry: "pantry",
  imposter: "imposter",
  zeroTrustLab: "zero-trust-lab (no real visitors - only speeds up your own testing of it)",
};

export default function PortfolioSettingsPage() {
  const { showAlsoBuilt, setShowAlsoBuilt } = useShowAlsoBuilt();
  const { pageLoadWarmup, setPageLoadWarmup } = usePageLoadWarmup();
  const {
    config: pcConfig,
    pending: pcPending,
    error: pcError,
    setSchedule: setPcSchedule,
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

      {pcAvailable && (
        <div className="form-row">
          <p className="form-label">
            Keep warm with provisioned concurrency (Sydney time) - no cold starts for real visitors during the
            window you set below, ~$1.58/mo each at 11h/day, 256MB
          </p>
          {pcConfig &&
            (Object.keys(PC_FUNCTION_LABELS) as PcFunctionKey[]).map((fn) => (
              <PcProjectSchedule
                key={fn}
                fn={fn}
                label={PC_FUNCTION_LABELS[fn]}
                schedule={pcConfig[fn]}
                pending={pcPending}
                onSave={(schedule) => setPcSchedule(fn, schedule)}
              />
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
