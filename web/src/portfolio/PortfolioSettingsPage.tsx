import { Link } from "react-router-dom";
import { useShowAlsoBuilt } from "./hooks/useShowAlsoBuilt";
import { useZeroTrustWarmup } from "./hooks/useZeroTrustWarmup";
import "./portfolio.css";

export default function PortfolioSettingsPage() {
  const { showAlsoBuilt, setShowAlsoBuilt } = useShowAlsoBuilt();
  const { enabled: warmupEnabled, pending: warmupPending, error: warmupError, setEnabled: setWarmupEnabled, available: warmupAvailable } = useZeroTrustWarmup();

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

      {warmupAvailable && (
        <div className="form-row">
          <label className="form-label" htmlFor="zero-trust-warmup">
            <input
              id="zero-trust-warmup"
              type="checkbox"
              checked={warmupEnabled ?? false}
              disabled={warmupEnabled === null || warmupPending}
              onChange={(e) => setWarmupEnabled(e.target.checked)}
            />{" "}
            Keep the zero-trust-lab demo Lambdas warm (pings every 10 minutes)
          </label>
          {warmupError && <p className="section-hint">{warmupError}</p>}
        </div>
      )}

      <p className="section-hint">
        <Link to="/">← back home</Link>
      </p>
    </>
  );
}
