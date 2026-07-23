import { useState } from "react";
import { Link } from "react-router-dom";
import Footer from "../portfolio/components/Footer";
import PantryCommandBar from "./components/PantryCommandBar";
import PantryInventorySection from "./components/PantryInventorySection";
import PantryManualAddSection from "./components/PantryManualAddSection";
import PantryShoppingListSection from "./components/PantryShoppingListSection";
import { usePantryHome } from "./hooks/usePantryHome";
import { usePantryAuth } from "./hooks/usePantryAuth";
import "./pantry.css";

export default function Pantry() {
  const { items, shoppingList, settings, error, refetch, updateSettings } = usePantryHome();
  const { email, signIn, signOut } = usePantryAuth();
  const [showAbout, setShowAbout] = useState(false);

  // Awaited by callers before re-enabling their own busy state (e.g. the
  // staple star toggle) - without that, a quick second click computes its
  // next value from stale props because the refetch hadn't landed yet,
  // which looked like the toggle "getting stuck" instead of flipping back.
  async function refetchAll() {
    await refetch();
  }

  return (
    <>
      <header className="pantry-head pantry-head-row">
        <h1>
          Pantry
          <button
            type="button"
            className="pantry-info-btn"
            onClick={() => setShowAbout((v) => !v)}
            aria-label="What is this page?"
            aria-expanded={showAbout}
          >
            i
          </button>
        </h1>
        <div className="pantry-head-actions">
          {email ? (
            <button type="button" className="pantry-account" onClick={signOut} title="Sign out">
              {email}
            </button>
          ) : (
            <button type="button" className="pantry-account" onClick={signIn}>
              Sign in
            </button>
          )}
          <Link
            to="/pantry/settings"
            className="pantry-settings-cog"
            aria-label="Pantry settings"
            title="Settings"
          >
            ⚙
          </Link>
        </div>
      </header>

      {showAbout && (
        <p className="pantry-about">
          I kept forgetting what I actually had in the fridge and pantry (spices, especially) - and kept
          forgetting what I needed to buy. So I built this to keep track of it for me.
        </p>
      )}

      {error && (
        <p className="status-line">// couldn&apos;t load inventory from the API right now ({error}).</p>
      )}

      <PantryCommandBar
        items={items ?? []}
        onChanged={refetchAll}
        nerdMode={settings?.nerdModeCommandBar ?? false}
      />

      {shoppingList && items && settings && (
        <PantryShoppingListSection
          entries={shoppingList}
          items={items}
          settings={settings}
          onSettingsChange={updateSettings}
          onChanged={refetchAll}
        />
      )}

      {items && settings && (
        <>
          <PantryInventorySection
            items={items}
            settings={settings}
            onSettingsChange={updateSettings}
            onChanged={refetchAll}
          />
          <PantryManualAddSection
            commonItems={settings.commonItems}
            onCommonItemsChange={(commonItems) => updateSettings({ commonItems })}
            settings={settings}
            onSettingsChange={updateSettings}
            onAdded={refetchAll}
          />
        </>
      )}
      <Footer />
    </>
  );
}
