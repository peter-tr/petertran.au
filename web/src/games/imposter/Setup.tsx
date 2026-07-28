import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  runImposterQuery,
  IMPOSTER_CATEGORIES_QUERY,
  CREATE_IMPOSTER_GAME_MUTATION,
  ImposterWordSource,
  ImposterDifficulty,
  type ImposterCategory,
  type ImposterCategoriesResult,
  type CreateImposterGameResult,
} from "./lib/api";
import { addRecentGame } from "./lib/recentGamesStore";
import RecentGames from "./components/RecentGames";
import LiveGames from "./components/LiveGames";
import StatsPanel from "./components/StatsPanel";
import Footer from "../../shared/components/Footer";
import "./imposter.css";

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 12;

function maxImposterCount(playerCount: number): number {
  return Math.max(1, playerCount - 2);
}

interface LocationState {
  prefillNames?: string[];
}

// Only the built-in word source sends a picked category id; AI games leave it
// off entirely and (optionally) send a free-text theme instead.
function categoryIdFor(wordSource: ImposterWordSource, categoryId: string | null): string | null | undefined {
  return wordSource === ImposterWordSource.Builtin ? categoryId : undefined;
}

// A custom AI theme is only sent when the AI source is selected *and* the
// player actually typed one - a blank box means "surprise me" either way.
function customCategoryFor(
  wordSource: ImposterWordSource,
  aiThemeMode: "surprise" | "custom",
  customCategory: string
): string | undefined {
  if (wordSource !== ImposterWordSource.Ai || aiThemeMode !== "custom") return undefined;

  return customCategory.trim() || undefined;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

// This form is a stack of pick-one button rows that all share the same base
// class and "active" modifier - one named helper instead of the same
// `? "active" : ""` ternary inlined at all eleven of them.
function categoryBtnClass(active: boolean): string {
  return active ? "imposter-category-btn active" : "imposter-category-btn";
}

// The player roster and the imposter-count stepper are one self-contained
// bundle of state - the list drives how many imposters are even allowed - so
// they live here rather than inline in the component, which keeps the roster
// rules readable on their own and out of the setup form's own complexity.
function usePlayerSetup(prefillNames: string[] | undefined) {
  const [names, setNames] = useState<string[]>(prefillNames?.length ? prefillNames : ["", "", ""]);
  const [imposterCount, setImposterCount] = useState(1);
  const [imposterCountNotice, setImposterCountNotice] = useState<string | null>(null);
  const [playerListNotice, setPlayerListNotice] = useState<string | null>(null);

  // Blank fields default to "Player N" rather than being dropped, so the
  // game can start without everyone having typed a name yet.
  const effectiveNames = names.map((n, i) => n.trim() || `Player ${i + 1}`);
  const maxImposters = maxImposterCount(effectiveNames.length);
  // Derived rather than synced back into state via an effect - imposterCount
  // only ever needs clamping at the point it's read (displayed or submitted).
  const effectiveImposterCount = Math.min(imposterCount, maxImposters);

  function updateName(index: number, value: string) {
    setNames((prev) => prev.map((n, i) => (i === index ? value : n)));
  }

  function addPlayer() {
    setImposterCountNotice(null);
    if (names.length >= MAX_PLAYERS) {
      setPlayerListNotice(`Imposter supports up to ${MAX_PLAYERS} players.`);

      return;
    }
    setPlayerListNotice(null);
    setNames((prev) => [...prev, ""]);
  }

  function removePlayer(index: number) {
    setImposterCountNotice(null);
    if (names.length <= MIN_PLAYERS) {
      setPlayerListNotice(`Imposter needs at least ${MIN_PLAYERS} players.`);

      return;
    }
    setPlayerListNotice(null);
    setNames((prev) => prev.filter((_, i) => i !== index));
  }

  function clearNames() {
    setImposterCountNotice(null);
    if (names.every((n) => n.trim() === "")) {
      setPlayerListNotice("No player names to clear yet.");

      return;
    }
    setPlayerListNotice(null);
    setNames((prev) => prev.map(() => ""));
  }

  function incrementImposterCount() {
    setPlayerListNotice(null);
    if (effectiveImposterCount >= maxImposters) {
      setImposterCountNotice(
        `Add more players to allow more imposters (up to ${maxImposters} with ${effectiveNames.length} players).`
      );

      return;
    }
    setImposterCountNotice(null);
    setImposterCount(effectiveImposterCount + 1);
  }

  function decrementImposterCount() {
    setImposterCountNotice(null);
    setImposterCount(Math.max(1, effectiveImposterCount - 1));
  }

  return {
    names,
    effectiveNames,
    effectiveImposterCount,
    imposterCountNotice,
    playerListNotice,
    updateName,
    addPlayer,
    removePlayer,
    clearNames,
    incrementImposterCount,
    decrementImposterCount,
  };
}

export default function ImposterSetup() {
  const navigate = useNavigate();
  const location = useLocation();
  const prefillNames = (location.state as LocationState | null)?.prefillNames;

  const [categories, setCategories] = useState<ImposterCategory[] | null>(null);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [wordSource, setWordSource] = useState<ImposterWordSource>(ImposterWordSource.Builtin);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [aiThemeMode, setAiThemeMode] = useState<"surprise" | "custom">("surprise");
  const [customCategory, setCustomCategory] = useState("");
  const [hintEnabled, setHintEnabled] = useState(true);
  const [difficulty, setDifficulty] = useState<ImposterDifficulty>(ImposterDifficulty.Normal);
  const [hideCategory, setHideCategory] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const {
    names,
    effectiveNames,
    effectiveImposterCount,
    imposterCountNotice,
    playerListNotice,
    updateName,
    addPlayer,
    removePlayer,
    clearNames,
    incrementImposterCount,
    decrementImposterCount,
  } = usePlayerSetup(prefillNames);

  useEffect(() => {
    runImposterQuery<ImposterCategoriesResult>(IMPOSTER_CATEGORIES_QUERY)
      .then((res) => {
        setCategories(res.imposterCategories);
        setCategoryId((current) => current ?? res.imposterCategories[0]?.id ?? null);
      })
      .catch((err) => setCategoriesError(errorMessage(err, "Failed to load categories")));
  }, []);

  const canSubmit =
    !submitting &&
    names.length >= MIN_PLAYERS &&
    (wordSource === ImposterWordSource.Ai || categoryId !== null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await runImposterQuery<CreateImposterGameResult>(CREATE_IMPOSTER_GAME_MUTATION, {
        wordSource,
        categoryId: categoryIdFor(wordSource, categoryId),
        customCategory: customCategoryFor(wordSource, aiThemeMode, customCategory),
        playerNames: effectiveNames,
        imposterCount: effectiveImposterCount,
        hintEnabled,
        difficulty,
        hideCategory,
      });
      addRecentGame({
        gameId: res.createImposterGame.gameId,
        categoryLabel: res.createImposterGame.categoryLabel,
        playerNames: res.createImposterGame.players.map((p) => p.name),
        createdAt: new Date().toISOString(),
      });
      navigate(`/imposter/${res.createImposterGame.gameId}`);
    } catch (err) {
      setError(errorMessage(err, "Couldn't start the game - please try again."));
      setSubmitting(false);
    }
  }

  return (
    <>
      <header className="imposter-head imposter-head-row">
        <h1>
          <span>Imposter</span>
          <button
            type="button"
            className="imposter-info-btn"
            onClick={() => setShowAbout((v) => !v)}
            aria-label="What is this page?"
            aria-expanded={showAbout}
          >
            i
          </button>
        </h1>
      </header>

      {showAbout && (
        <p className="imposter-about">
          Built for game nights where we kept losing track of whose turn it was to think of a word and quietly
          show it around - this hands out the secret word (and the imposter's decoy) for you, so everyone can
          just play.
        </p>
      )}

      <p className="project-desc" style={{ marginBottom: "1rem" }}>
        Everyone gets the same secret word - except the imposter(s), who get something close but different.
        Pass the device around, discuss out loud, and vote out whoever seems off.
      </p>

      <RecentGames />
      <LiveGames />

      <form className="imposter-setup" onSubmit={handleSubmit}>
        <div className="imposter-field-group">
          <p className="form-label">Word source</p>
          <div className="imposter-category-grid">
            <button
              type="button"
              className={categoryBtnClass(wordSource === ImposterWordSource.Builtin)}
              onClick={() => setWordSource(ImposterWordSource.Builtin)}
            >
              Built-in category
            </button>
            <button
              type="button"
              className={categoryBtnClass(wordSource === ImposterWordSource.Ai)}
              onClick={() => setWordSource(ImposterWordSource.Ai)}
            >
              AI-generated
            </button>
          </div>
        </div>

        {wordSource === ImposterWordSource.Builtin ? (
          <div className="imposter-field-group">
            <p className="form-label">Category</p>
            {categoriesError && <p className="status-line">// {categoriesError}</p>}
            {!categories && !categoriesError && <p className="status-line">// loading categories…</p>}
            {categories && (
              <div className="imposter-category-grid">
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    className={categoryBtnClass(categoryId === cat.id)}
                    onClick={() => setCategoryId(cat.id)}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="imposter-field-group">
            <p className="form-label">Theme</p>
            <div className="imposter-category-grid">
              <button
                type="button"
                className={categoryBtnClass(aiThemeMode === "surprise")}
                onClick={() => setAiThemeMode("surprise")}
              >
                Surprise me
              </button>
              <button
                type="button"
                className={categoryBtnClass(aiThemeMode === "custom")}
                onClick={() => setAiThemeMode("custom")}
              >
                Custom theme
              </button>
            </div>
            {aiThemeMode === "custom" && (
              <input
                className="form-input"
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                placeholder="e.g. 80s movies, types of pasta, superheroes…"
                maxLength={60}
              />
            )}
          </div>
        )}

        <div className="imposter-field-group">
          <p className="form-label">Category label</p>
          <div className="imposter-category-grid">
            <button
              type="button"
              className={categoryBtnClass(!hideCategory)}
              onClick={() => setHideCategory(false)}
            >
              Visible
            </button>
            <button
              type="button"
              className={categoryBtnClass(hideCategory)}
              onClick={() => setHideCategory(true)}
            >
              Hidden
            </button>
          </div>
          <p className="imposter-hint">
            {hideCategory
              ? "Players won't know the category until results - harder to bluff or catch the imposter."
              : "Players see the category throughout the game."}
          </p>
        </div>

        <div className="imposter-field-group">
          <p className="form-label">
            Players{" "}
            <span className="imposter-hint">
              ({MIN_PLAYERS}–{MAX_PLAYERS}, names optional - blank ones become "Player N")
            </span>
          </p>
          <div className="imposter-player-actions">
            <button type="button" className="imposter-add-btn" onClick={addPlayer}>
              + Add player
            </button>
            <button type="button" className="imposter-add-btn" onClick={clearNames}>
              Clear names
            </button>
          </div>
          <div className="imposter-player-list">
            {names.map((name, i) => (
              <div className="imposter-player-row" key={i}>
                <input
                  className="form-input"
                  value={name}
                  onChange={(e) => updateName(i, e.target.value)}
                  placeholder={`Player ${i + 1}`}
                  maxLength={40}
                />
                <button
                  type="button"
                  className="imposter-remove-btn"
                  onClick={() => removePlayer(i)}
                  aria-label={`Remove player ${i + 1}`}
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
          {playerListNotice && <p className="imposter-inline-notice">// {playerListNotice}</p>}
        </div>

        <div className="imposter-field-group">
          <p className="form-label">Number of imposters</p>
          <div className="imposter-stepper">
            <button
              type="button"
              className="imposter-remove-btn"
              onClick={decrementImposterCount}
              disabled={effectiveImposterCount <= 1}
              aria-label="Fewer imposters"
            >
              &minus;
            </button>
            <span className="imposter-stepper-value">{effectiveImposterCount}</span>
            <button
              type="button"
              className="imposter-remove-btn"
              onClick={incrementImposterCount}
              aria-label="More imposters"
            >
              +
            </button>
          </div>
          {imposterCountNotice && <p className="imposter-inline-notice">// {imposterCountNotice}</p>}
        </div>

        <div className="imposter-field-group">
          <p className="form-label">Hint word</p>
          <div className="imposter-category-grid">
            <button
              type="button"
              className={categoryBtnClass(hintEnabled)}
              onClick={() => setHintEnabled(true)}
            >
              Enabled
            </button>
            <button
              type="button"
              className={categoryBtnClass(!hintEnabled)}
              onClick={() => setHintEnabled(false)}
            >
              Disabled
            </button>
          </div>
          <p className="imposter-hint">
            {hintEnabled
              ? "The imposter gets a word of their own."
              : "The imposter gets nothing and has to bluff blind."}
          </p>
        </div>

        {hintEnabled && (
          <div className="imposter-field-group">
            <p className="form-label">Difficulty</p>
            <div className="imposter-category-grid">
              <button
                type="button"
                className={categoryBtnClass(difficulty === ImposterDifficulty.Normal)}
                onClick={() => setDifficulty(ImposterDifficulty.Normal)}
              >
                Normal
              </button>
              <button
                type="button"
                className={categoryBtnClass(difficulty === ImposterDifficulty.Hard)}
                onClick={() => setDifficulty(ImposterDifficulty.Hard)}
              >
                Hard
              </button>
            </div>
            <p className="imposter-hint">
              {difficulty === ImposterDifficulty.Normal
                ? "The imposter's word is closely related - easier to bluff."
                : "The imposter's word is a bigger stretch - harder to bluff convincingly."}
            </p>
          </div>
        )}

        {error && <p className="status-line">// {error}</p>}

        <button className="run-btn" type="submit" disabled={!canSubmit}>
          {submitting ? "Starting…" : "Start game"}
        </button>
      </form>

      <StatsPanel />
      <Footer />
    </>
  );
}
