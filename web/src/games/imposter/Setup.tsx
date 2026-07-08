import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  runImposterQuery,
  IMPOSTER_CATEGORIES_QUERY,
  CREATE_IMPOSTER_GAME_MUTATION,
  type ImposterCategory,
  type ImposterCategoriesResult,
  type ImposterWordSource,
  type CreateImposterGameResult,
} from "./api";
import "./imposter.css";

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 12;

function maxImposterCount(playerCount: number): number {
  return Math.max(1, playerCount - 2);
}

interface LocationState {
  prefillNames?: string[];
}

export default function ImposterSetup() {
  const navigate = useNavigate();
  const location = useLocation();
  const prefillNames = (location.state as LocationState | null)?.prefillNames;

  const [categories, setCategories] = useState<ImposterCategory[] | null>(null);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [wordSource, setWordSource] = useState<ImposterWordSource>("BUILTIN");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [aiThemeMode, setAiThemeMode] = useState<"surprise" | "custom">("surprise");
  const [customCategory, setCustomCategory] = useState("");
  const [names, setNames] = useState<string[]>(prefillNames?.length ? prefillNames : ["", "", ""]);
  const [imposterCount, setImposterCount] = useState(1);
  const [hintEnabled, setHintEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    runImposterQuery<ImposterCategoriesResult>(IMPOSTER_CATEGORIES_QUERY)
      .then((res) => {
        setCategories(res.imposterCategories);
        setCategoryId((current) => current ?? res.imposterCategories[0]?.id ?? null);
      })
      .catch((err) => setCategoriesError(err instanceof Error ? err.message : "Failed to load categories"));
  }, []);

  const validNames = names.map((n) => n.trim()).filter(Boolean);
  const maxImposters = maxImposterCount(validNames.length);
  // Derived rather than synced back into state via an effect - imposterCount
  // only ever needs clamping at the point it's read (displayed or submitted).
  const effectiveImposterCount = Math.min(imposterCount, maxImposters);

  function updateName(index: number, value: string) {
    setNames((prev) => prev.map((n, i) => (i === index ? value : n)));
  }

  function addPlayer() {
    setNames((prev) => (prev.length >= MAX_PLAYERS ? prev : [...prev, ""]));
  }

  function removePlayer(index: number) {
    setNames((prev) => (prev.length <= MIN_PLAYERS ? prev : prev.filter((_, i) => i !== index)));
  }

  const canSubmit =
    !submitting && validNames.length >= MIN_PLAYERS && (wordSource === "AI" || categoryId !== null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await runImposterQuery<CreateImposterGameResult>(CREATE_IMPOSTER_GAME_MUTATION, {
        wordSource,
        categoryId: wordSource === "BUILTIN" ? categoryId : undefined,
        customCategory: wordSource === "AI" && aiThemeMode === "custom" ? customCategory.trim() || undefined : undefined,
        playerNames: validNames,
        imposterCount: effectiveImposterCount,
        hintEnabled,
      });
      navigate(`/imposter/${res.createImposterGame.gameId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the game - please try again.");
      setSubmitting(false);
    }
  }

  return (
    <>
      <header className="page-head">
        <p className="eyebrow">one shared device, one word each</p>
        <h1>Imposter</h1>
        <p className="tagline">
          Everyone gets the same secret word - except the imposter(s), who get something close but
          different. Pass the device around, discuss out loud, and vote out whoever seems off.
        </p>
      </header>

      <form className="imposter-setup" onSubmit={handleSubmit}>
        <div className="imposter-field-group">
          <p className="form-label">Word source</p>
          <div className="imposter-category-grid">
            <button
              type="button"
              className={`imposter-category-btn ${wordSource === "BUILTIN" ? "active" : ""}`}
              onClick={() => setWordSource("BUILTIN")}
            >
              Built-in category
            </button>
            <button
              type="button"
              className={`imposter-category-btn ${wordSource === "AI" ? "active" : ""}`}
              onClick={() => setWordSource("AI")}
            >
              AI-generated
            </button>
          </div>
        </div>

        {wordSource === "BUILTIN" ? (
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
                    className={`imposter-category-btn ${categoryId === cat.id ? "active" : ""}`}
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
                className={`imposter-category-btn ${aiThemeMode === "surprise" ? "active" : ""}`}
                onClick={() => setAiThemeMode("surprise")}
              >
                Surprise me
              </button>
              <button
                type="button"
                className={`imposter-category-btn ${aiThemeMode === "custom" ? "active" : ""}`}
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
          <p className="form-label">
            Players <span className="imposter-hint">({MIN_PLAYERS}–{MAX_PLAYERS})</span>
          </p>
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
                  disabled={names.length <= MIN_PLAYERS}
                  aria-label={`Remove player ${i + 1}`}
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="imposter-add-btn"
            onClick={addPlayer}
            disabled={names.length >= MAX_PLAYERS}
          >
            + Add player
          </button>
        </div>

        <div className="imposter-field-group">
          <p className="form-label">Number of imposters</p>
          <div className="imposter-stepper">
            <button
              type="button"
              className="imposter-remove-btn"
              onClick={() => setImposterCount(Math.max(1, effectiveImposterCount - 1))}
              disabled={effectiveImposterCount <= 1}
              aria-label="Fewer imposters"
            >
              &minus;
            </button>
            <span className="imposter-stepper-value">{effectiveImposterCount}</span>
            <button
              type="button"
              className="imposter-remove-btn"
              onClick={() => setImposterCount(Math.min(maxImposters, effectiveImposterCount + 1))}
              disabled={effectiveImposterCount >= maxImposters}
              aria-label="More imposters"
            >
              +
            </button>
          </div>
        </div>

        <div className="imposter-field-group">
          <p className="form-label">Hint word</p>
          <div className="imposter-category-grid">
            <button
              type="button"
              className={`imposter-category-btn ${hintEnabled ? "active" : ""}`}
              onClick={() => setHintEnabled(true)}
            >
              Enabled
            </button>
            <button
              type="button"
              className={`imposter-category-btn ${!hintEnabled ? "active" : ""}`}
              onClick={() => setHintEnabled(false)}
            >
              Disabled
            </button>
          </div>
        </div>

        {error && <p className="status-line">// {error}</p>}

        <button className="run-btn" type="submit" disabled={!canSubmit}>
          {submitting ? "Starting…" : "Start game"}
        </button>
      </form>
    </>
  );
}
