import { useState } from "react";
import { Link } from "react-router-dom";
import PantryArchitectureDiagram from "./components/PantryArchitectureDiagram";
import { usePantrySettings } from "./hooks/usePantrySettings";
import { runPantryQuery, SYNC_PRICES_NOW_MUTATION, type SyncPricesNowResult } from "./api";
import "./pantry.css";

const HOURS = Array.from({ length: 24 }, (_, h) => h);

function formatHour(h: number): string {
  const period = h < 12 ? "am" : "pm";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:00${period}`;
}

type SyncStatus = "idle" | "syncing" | "done" | "error";

export default function PantrySettingsPage() {
  const { settings, error, updateSettings } = usePantrySettings();
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");

  async function handleSyncNow() {
    setSyncStatus("syncing");
    try {
      await runPantryQuery<SyncPricesNowResult>(SYNC_PRICES_NOW_MUTATION);
      setSyncStatus("done");
    } catch {
      setSyncStatus("error");
    }
  }

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
          <h2 className="pantry-panel-title">Price tracking</h2>
        </div>
        <p className="project-desc">
          Items flagged with the $ toggle get their Coles price checked once a day automatically. Use this to
          check them right now instead of waiting - results land on each item as soon as the check finishes,
          not instantly (it's the same background job, just triggered early).
        </p>
        <div className="form-row pantry-settings-row">
          <button
            type="button"
            className="pantry-edit-btn"
            onClick={handleSyncNow}
            disabled={syncStatus === "syncing"}
          >
            {syncStatus === "syncing" ? "Starting sync…" : "Sync prices now"}
          </button>
          {syncStatus === "done" && (
            <span className="status-line">// Sync started - check back in a minute or two.</span>
          )}
          {syncStatus === "error" && <span className="status-line">// Couldn&apos;t start the sync.</span>}
        </div>
      </section>

      {settings && (
        <section className="pantry-panel">
          <div className="pantry-panel-header">
            <h2 className="pantry-panel-title">Nerd mode</h2>
          </div>
          <p className="project-desc">
            Shows the AI call cost, duration, and Coles search/fetch counts behind each price check and command
            bar reply - split by list/feature since inventory, the shopping list, and the command bar are
            usually checked separately.
          </p>
          <div className="form-row pantry-settings-row">
            <label className="form-label" htmlFor="pantry-nerd-mode-inventory">
              <input
                id="pantry-nerd-mode-inventory"
                type="checkbox"
                checked={settings.nerdModeInventory}
                onChange={(e) => updateSettings({ nerdModeInventory: e.target.checked })}
              />{" "}
              Inventory
            </label>
          </div>
          <div className="form-row pantry-settings-row">
            <label className="form-label" htmlFor="pantry-nerd-mode-shopping-list">
              <input
                id="pantry-nerd-mode-shopping-list"
                type="checkbox"
                checked={settings.nerdModeShoppingList}
                onChange={(e) => updateSettings({ nerdModeShoppingList: e.target.checked })}
              />{" "}
              Shopping list
            </label>
          </div>
          <div className="form-row pantry-settings-row">
            <label className="form-label" htmlFor="pantry-nerd-mode-command-bar">
              <input
                id="pantry-nerd-mode-command-bar"
                type="checkbox"
                checked={settings.nerdModeCommandBar}
                onChange={(e) => updateSettings({ nerdModeCommandBar: e.target.checked })}
              />{" "}
              Command bar
            </label>
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
