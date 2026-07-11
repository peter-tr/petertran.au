import { Link } from "react-router-dom";
import PantryArchitectureDiagram from "./components/PantryArchitectureDiagram";
import { usePantrySettings } from "./hooks/usePantrySettings";
import "./pantry.css";

const HOURS = Array.from({ length: 24 }, (_, h) => h);

function formatHour(h: number): string {
  const period = h < 12 ? "am" : "pm";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:00${period}`;
}

export default function PantrySettingsPage() {
  const { settings, error, updateSettings } = usePantrySettings();

  return (
    <>
      <header className="pantry-head">
        <h1>Pantry settings</h1>
        <Link to="/pantry" className="pantry-settings-back">
          ← back to pantry
        </Link>
      </header>

      {error && <p className="status-line">// couldn&apos;t load settings right now ({error}).</p>}

      {settings && (
        <section className="pantry-panel">
          <div className="pantry-panel-header">
            <h2 className="pantry-panel-title">Digest email</h2>
          </div>

          <p className="project-desc">
            A daily reminder email of shopping-list items marked urgent. Only sends when at least one urgent
            item exists - an empty list means no email that day.
          </p>

          <div className="form-row pantry-settings-row">
            <label className="form-label" htmlFor="pantry-digest-enabled">
              <input
                id="pantry-digest-enabled"
                type="checkbox"
                checked={settings.digestEnabled}
                onChange={(e) => updateSettings({ digestEnabled: e.target.checked })}
              />{" "}
              Send the daily digest email
            </label>
          </div>

          <div className="form-row pantry-settings-row">
            <label className="form-label" htmlFor="pantry-digest-hour">
              Send time (Australia/Sydney)
            </label>
            <select
              id="pantry-digest-hour"
              className="form-input pantry-settings-hour"
              value={settings.digestHour}
              onChange={(e) => updateSettings({ digestHour: Number(e.target.value) })}
              disabled={!settings.digestEnabled}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {formatHour(h)}
                </option>
              ))}
            </select>
          </div>
        </section>
      )}

      <section className="pantry-panel">
        <div className="pantry-panel-header">
          <h2 className="pantry-panel-title">Architecture</h2>
        </div>
        <p className="project-desc" style={{ marginBottom: "1rem" }}>
          Pantry is its own Lambda, DynamoDB table, and CDK stack, separate from the resume site - the AI
          command bar and this digest email are the two paths through it.
        </p>
        <PantryArchitectureDiagram />
      </section>
    </>
  );
}
