import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import PantryArchitectureDiagram from "./components/PantryArchitectureDiagram";
import { usePantrySettings } from "./hooks/usePantrySettings";
import {
  runPantryQuery,
  SYNC_PRICES_NOW_MUTATION,
  PRICE_SYNC_STATUS_QUERY,
  type SyncPricesNowResult,
  type PriceSyncStatus,
  type PriceSyncStatusResult,
} from "./api";
import "./pantry.css";

const HOURS = Array.from({ length: 24 }, (_, h) => h);

function formatHour(h: number): string {
  const period = h < 12 ? "am" : "pm";
  const display = h % 12 === 0 ? 12 : h % 12;

  return `${display}:00${period}`;
}

// Rough average from real check-prices.ts calls observed this session
// (mostly web_search + an occasional web_fetch, 6-12s each) - a ballpark
// for "how long is this going to take", not a measured guarantee.
const AVG_SECONDS_PER_ITEM = 8;

function formatEstimate(seconds: number): string {
  if (seconds < 60) return `~${Math.max(1, Math.round(seconds))}s`;

  return `~${Math.round(seconds / 60)}m`;
}

export default function PantrySettingsPage() {
  const { settings, error, updateSettings } = usePantrySettings();
  const [syncStatus, setSyncStatus] = useState<PriceSyncStatus | null>(null);
  const [syncTriggerError, setSyncTriggerError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  // Fetch-only, no setState of its own - callers each set syncStatus
  // themselves from the result. Keeping the setState call visible at each
  // call site (rather than buried in here) is what tells React's effect
  // linter this is the endorsed "call setState in a callback when external
  // state changes" shape, not an effect synchronously deriving state.
  async function fetchStatus(): Promise<PriceSyncStatus | null> {
    try {
      const data = await runPantryQuery<PriceSyncStatusResult>(PRICE_SYNC_STATUS_QUERY);

      return data.priceSyncStatus;
    } catch {
      return null;
    }
  }

  function startPolling() {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const status = await fetchStatus();
      setSyncStatus(status);
      if (status && !status.running) stopPolling();
    }, 2000);
  }

  // Reflects whatever triggered the run - the schedule, another device's
  // "sync now" click, or a single-item auto-trigger from toggling
  // trackPrice - not just this page's own button, so opening Settings
  // while one happens to be running shows it immediately.
  useEffect(() => {
    let ignore = false;
    fetchStatus().then((status) => {
      if (ignore) return;
      setSyncStatus(status);
      if (status?.running) startPolling();
    });

    return () => {
      ignore = true;
      stopPolling();
    };
  }, []);

  async function handleSyncNow() {
    setSyncTriggerError(null);
    try {
      await runPantryQuery<SyncPricesNowResult>(SYNC_PRICES_NOW_MUTATION);
      setSyncStatus(await fetchStatus());
      startPolling();
    } catch {
      setSyncTriggerError("Couldn't start the sync.");
    }
  }

  const isSyncing = syncStatus?.running ?? false;
  const remainingSeconds = syncStatus
    ? Math.max(syncStatus.totalItems - syncStatus.checkedItems, 0) * AVG_SECONDS_PER_ITEM
    : 0;

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
          check them right now instead of waiting.
        </p>
        <div className="form-row pantry-settings-row">
          <button type="button" className="pantry-edit-btn" onClick={handleSyncNow} disabled={isSyncing}>
            {isSyncing ? <span className="pantry-spinner" aria-hidden="true" /> : "Sync prices now"}
          </button>
          {isSyncing && syncStatus && (
            <span className="status-line">
              // checking {syncStatus.checkedItems} of {syncStatus.totalItems}
              {remainingSeconds > 0 && ` - ${formatEstimate(remainingSeconds)} remaining`}
            </span>
          )}
          {!isSyncing && syncStatus?.finishedAt && (
            <span className="status-line">
              // last synced {syncStatus.checkedItems} of {syncStatus.totalItems} item
              {syncStatus.totalItems === 1 ? "" : "s"}
              {syncStatus.errors.length > 0 && ` (${syncStatus.errors.length} failed)`}
            </span>
          )}
          {syncTriggerError && <span className="status-line">// {syncTriggerError}</span>}
        </div>

        {syncStatus && syncStatus.errors.length > 0 && (
          <div className="pantry-sync-errors">
            <p className="form-label">Recent errors</p>
            <ul>
              {syncStatus.errors.map((e, i) => (
                <li key={i}>
                  <span className="pantry-sync-error-item">{e.itemName}</span> - {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {settings && (
        <section className="pantry-panel">
          <div className="pantry-panel-header">
            <h2 className="pantry-panel-title">Nerd mode</h2>
          </div>
          <p className="project-desc">
            Shows the AI call cost, duration, and Coles search/fetch counts behind each price check and
            command bar reply - split by list/feature since inventory, the shopping list, and the command bar
            are usually checked separately.
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
