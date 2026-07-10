import { useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import {
  runPantryQuery,
  PARSE_COMMAND_QUERY,
  PANTRY_ACTION_MUTATIONS,
  type ConversationMessage,
  type ParseCommandResult,
  type ParsedCommand,
  type ProposedAction,
  type RecipeSuggestion,
} from "../api";
import { scaleAmount, scalePrice } from "../lib/recipeScaling";

type ActionsStatus = "pending" | "confirming" | "done" | "cancelled";

interface UserTurn {
  role: "user";
  text: string;
}

interface AssistantTurn {
  role: "assistant";
  result: ParsedCommand;
  expandedActions: Set<number>;
  actionsStatus: ActionsStatus;
  actionsError: string | null;
  // Missing ingredients the user has clicked off, keyed by
  // "recipeIndex-ingredientIndex" - excluded from "+ add N missing
  // ingredients to shopping list" without needing a whole extra AI turn
  // just to say "skip the pesto".
  excludedIngredients: Set<string>;
  // Current servings per recipe index - defaults to that recipe's
  // baseServings when absent (see servingsFor below).
  recipeServings: Record<number, number>;
}

type Turn = UserTurn | AssistantTurn;

interface PantryCommandBarProps {
  onChanged: () => Promise<void>;
}

// Only the last few turns are sent back as context on each call - a
// personal pantry's inventory/shopping-list state is small, but there's no
// reason to let token cost grow unbounded across a very long conversation.
const MAX_HISTORY_TURNS = 10;

// Enum-valued fields render unquoted in GraphQL (e.g. FRIDGE, not "FRIDGE") -
// everything else follows normal JSON-ish literal formatting.
const ENUM_FIELDS = new Set(["location"]);

function formatGraphQLValue(key: string | null, value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return key && ENUM_FIELDS.has(key) ? value : JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => formatGraphQLValue(null, v)).join(", ")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${formatGraphQLValue(k, v)}`)
      .join(", ");
    return `{ ${entries} }`;
  }
  return JSON.stringify(value);
}

// Reconstructs a readable GraphQL mutation from the server's {mutationName,
// argsJson} pair, purely for the "view mutation" transparency panel - this
// text is never sent anywhere, the real call uses PANTRY_ACTION_MUTATIONS.
function formatMutationPreview(mutationName: string, argsJson: string): string {
  try {
    const args = JSON.parse(argsJson) as Record<string, unknown>;
    const argsText = Object.entries(args)
      .map(([k, v]) => `${k}: ${formatGraphQLValue(k, v)}`)
      .join(", ");
    return `mutation {\n  ${mutationName}(${argsText})\n}`;
  } catch {
    return `${mutationName}(${argsJson})`;
  }
}

// Turns a recipe's missing ingredients into the same {mutationName,
// argsJson} shape parseCommand itself produces - no extra AI call, this is
// just client-side synthesis feeding the exact same confirm/preview UI.
// `excluded` holds "recipeIndex-ingredientIndex" keys the user clicked off.
// `ratio` scales each ingredient's amount to whatever servings the recipe
// card is currently showing, so the shopping-list note reflects what's
// actually needed rather than always the recipe's base amount.
function buildRecipeShoppingActions(
  recipe: RecipeSuggestion,
  recipeIndex: number,
  excluded: Set<string>,
  ratio: number
): ProposedAction[] {
  return recipe.ingredients
    .filter((ing, ii) => !ing.haveInInventory && !excluded.has(`${recipeIndex}-${ii}`))
    .map((ing) => {
      const amount = scaleAmount(ing.amount, ing.quantity, ratio);
      const note = amount ? `${amount} - for: ${recipe.name}` : `For: ${recipe.name}`;
      return {
        type: "ADD_TO_SHOPPING_LIST",
        summary: `Add "${ing.name}"${amount ? ` (${amount})` : ""} to the shopping list (for: ${recipe.name})`,
        mutationName: "addToShoppingList",
        argsJson: JSON.stringify({ name: ing.name, quantity: null, unit: null, note, recipeTag: recipe.name }),
      };
    });
}

// Recipe amounts/nutrition are calibrated to `baseServings` - this looks up
// whatever the user has set the stepper to (default: baseServings itself).
function servingsFor(turn: AssistantTurn, recipeIndex: number, recipe: RecipeSuggestion): number {
  return turn.recipeServings[recipeIndex] ?? recipe.baseServings;
}

export default function PantryCommandBar({ onChanged }: PantryCommandBarProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [thinking, setThinking] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function resetTextareaHeight() {
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  function clearConversation() {
    setTurns([]);
    setInput("");
    setSubmitError(null);
    setThinking(false);
    resetTextareaHeight();
  }

  // Grows the box to fit what's typed - stays single-line at rest, expands
  // as text wraps instead of scrolling horizontally inside a fixed box.
  function handleInputChange(e: ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${e.target.scrollHeight}px`;
  }

  // Enter submits like a chat/command input; Shift+Enter still inserts a
  // literal newline for a genuinely multi-line command.
  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  }

  function updateAssistantTurn(index: number, patch: Partial<AssistantTurn>) {
    setTurns((prev) => prev.map((t, i) => (i === index && t.role === "assistant" ? { ...t, ...patch } : t)));
  }

  function toggleExpandedAction(turnIndex: number, actionIndex: number) {
    setTurns((prev) =>
      prev.map((t, i) => {
        if (i !== turnIndex || t.role !== "assistant") return t;
        const next = new Set(t.expandedActions);
        if (next.has(actionIndex)) next.delete(actionIndex);
        else next.add(actionIndex);
        return { ...t, expandedActions: next };
      })
    );
  }

  // Fine-grained control: drop a single proposed action from the batch
  // without cancelling the whole thing. Resets expandedActions since
  // indices shift once an entry is removed.
  function removeAction(turnIndex: number, actionIndex: number) {
    setTurns((prev) =>
      prev.map((t, i) => {
        if (i !== turnIndex || t.role !== "assistant" || !t.result.actions) return t;
        return {
          ...t,
          result: { ...t.result, actions: t.result.actions.filter((_, ai) => ai !== actionIndex) },
          expandedActions: new Set(),
        };
      })
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || thinking) return;

    // Feeds Claude back its own prior structured output as the assistant's
    // side of the conversation, so a reply like "shopping list, 1 bottle"
    // can complete an earlier clarifying question instead of being parsed
    // alone as a new, likely-unclear input. Recipe turns get client-only
    // state (servings, excluded ingredients) merged in first - the server
    // never saw those, so without this the AI has no way to know a
    // follow-up like "remove the salt" already happened, or what serving
    // count is currently showing.
    const history: ConversationMessage[] = turns.slice(-MAX_HISTORY_TURNS).map((t) => {
      if (t.role === "user") return { role: "user", content: t.text };
      const content = t.result.recipes
        ? {
            ...t.result,
            recipes: t.result.recipes.map((r, ri) => ({
              ...r,
              currentServings: servingsFor(t, ri, r),
              excludedIngredientIndexes: r.ingredients
                .map((_, ii) => ii)
                .filter((ii) => t.excludedIngredients.has(`${ri}-${ii}`)),
            })),
          }
        : t.result;
      return { role: "assistant", content: JSON.stringify(content) };
    });

    setTurns((prev) => [...prev, { role: "user", text: trimmed }]);
    setInput("");
    resetTextareaHeight();
    setThinking(true);
    setSubmitError(null);

    try {
      const data = await runPantryQuery<ParseCommandResult>(PARSE_COMMAND_QUERY, { input: trimmed, history });
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          result: data.parseCommand,
          expandedActions: new Set(),
          actionsStatus: "pending",
          actionsError: null,
          excludedIngredients: new Set(),
          recipeServings: {},
        },
      ]);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setThinking(false);
    }
  }

  function toggleExcludedIngredient(turnIndex: number, recipeIndex: number, ingredientIndex: number) {
    const key = `${recipeIndex}-${ingredientIndex}`;
    setTurns((prev) =>
      prev.map((t, i) => {
        if (i !== turnIndex || t.role !== "assistant") return t;
        const next = new Set(t.excludedIngredients);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return { ...t, excludedIngredients: next };
      })
    );
  }

  function setServings(turnIndex: number, recipeIndex: number, next: number) {
    if (next < 1) return;
    setTurns((prev) =>
      prev.map((t, i) =>
        i === turnIndex && t.role === "assistant"
          ? { ...t, recipeServings: { ...t.recipeServings, [recipeIndex]: next } }
          : t
      )
    );
  }

  function handleAddMissingIngredients(turnIndex: number, recipe: RecipeSuggestion, recipeIndex: number) {
    const turn = turns[turnIndex];
    if (turn.role !== "assistant") return;
    const ratio = servingsFor(turn, recipeIndex, recipe) / recipe.baseServings;
    const actions = buildRecipeShoppingActions(recipe, recipeIndex, turn.excludedIngredients, ratio);
    if (actions.length === 0) return;
    updateAssistantTurn(turnIndex, {
      result: { ...turn.result, actions },
      actionsStatus: "pending",
      actionsError: null,
    });
  }

  async function confirmActions(turnIndex: number, actions: ProposedAction[]) {
    updateAssistantTurn(turnIndex, { actionsStatus: "confirming", actionsError: null });

    const failures: string[] = [];
    for (const action of actions) {
      const mutation = PANTRY_ACTION_MUTATIONS[action.mutationName];
      if (!mutation) {
        failures.push(`Unknown action "${action.mutationName}" - skipped.`);
        continue;
      }
      try {
        const variables = JSON.parse(action.argsJson) as Record<string, unknown>;
        await runPantryQuery(mutation, variables);
      } catch (err) {
        failures.push(`${action.summary}: ${err instanceof Error ? err.message : "failed"}`);
      }
    }

    await onChanged();

    if (failures.length) {
      updateAssistantTurn(turnIndex, { actionsStatus: "pending", actionsError: failures.join(" ") });
    } else {
      updateAssistantTurn(turnIndex, { actionsStatus: "done", actionsError: null });
    }
  }

  // Recipes represent "the current suggestion we're iterating on" - only
  // the latest one should render as a live card, or a refinement like
  // "remove garlic" would appear to duplicate the card instead of updating
  // it. Older turns' answer/message/actions still render normally; this
  // only suppresses stale recipe cards.
  const lastRecipesTurnIndex = turns.reduce(
    (acc, t, i) => (t.role === "assistant" && t.result.recipes && t.result.recipes.length > 0 ? i : acc),
    -1
  );

  return (
    <section className="pantry-panel pantry-command-bar">
      <div className="pantry-panel-header">
        <h2 className="pantry-panel-title">Ask or tell it what to do</h2>
        {turns.length > 0 && (
          <button type="button" className="pantry-details-toggle" onClick={clearConversation}>
            Clear
          </button>
        )}
      </div>

      {turns.length > 0 && (
        <div className="pantry-command-turns">
          {turns.map((turn, i) =>
            turn.role === "user" ? (
              <p className="pantry-command-turn-user" key={i}>
                {turn.text}
              </p>
            ) : (
              <div className="pantry-command-turn-assistant" key={i}>
                {turn.result.answer && <p className="pantry-command-answer">{turn.result.answer}</p>}

                {turn.result.answerItems && turn.result.answerItems.length > 0 && (
                  <ul className="pantry-command-answer-items">
                    {turn.result.answerItems.map((item, ii) => (
                      <li key={ii}>{item}</li>
                    ))}
                  </ul>
                )}

                {i === lastRecipesTurnIndex && turn.result.recipes && turn.result.recipes.length > 0 && (
                  <div className="pantry-command-recipes">
                    {turn.result.recipes.map((recipe, ri) => {
                      const missingCount = recipe.ingredients.filter(
                        (ing, ii) => !ing.haveInInventory && !turn.excludedIngredients.has(`${ri}-${ii}`)
                      ).length;
                      const servings = servingsFor(turn, ri, recipe);
                      const ratio = servings / recipe.baseServings;
                      const totalPriceAud = recipe.ingredients.reduce(
                        (sum, ing) => sum + scalePrice(ing.estimatedPriceAud, ing.quantity, ratio),
                        0
                      );
                      return (
                        <div className="pantry-command-recipe" key={ri}>
                          <div className="pantry-command-recipe-header">
                            <p className="pantry-command-recipe-name">{recipe.name}</p>
                            <div className="pantry-command-servings">
                              <button
                                type="button"
                                className="qty-stepper-btn"
                                onClick={() => setServings(i, ri, servings - 1)}
                                disabled={servings <= 1}
                              >
                                −
                              </button>
                              <span className="pantry-command-servings-count">
                                {servings} serving{servings > 1 ? "s" : ""}
                              </span>
                              <button
                                type="button"
                                className="qty-stepper-btn"
                                onClick={() => setServings(i, ri, servings + 1)}
                              >
                                +
                              </button>
                            </div>
                          </div>
                          {recipe.description && (
                            <p className="pantry-command-recipe-desc">{recipe.description}</p>
                          )}
                          <p className="pantry-command-recipe-nutrition">
                            {Math.round(recipe.caloriesPerServing)} kcal · {Math.round(recipe.proteinGPerServing)}g
                            protein · {Math.round(recipe.carbsGPerServing)}g carbs ·{" "}
                            {Math.round(recipe.fatGPerServing)}g fat <span className="status-line">(per serving, AI estimate)</span>
                          </p>
                          <ul className="pantry-command-recipe-ingredients">
                            {recipe.ingredients.map((ing, ii) => {
                              const excluded = turn.excludedIngredients.has(`${ri}-${ii}`);
                              const clickable = !ing.haveInInventory;
                              const amount = scaleAmount(ing.amount, ing.quantity, ratio);
                              const price = scalePrice(ing.estimatedPriceAud, ing.quantity, ratio);
                              return (
                                <li
                                  key={ii}
                                  className={[
                                    ing.haveInInventory
                                      ? "pantry-command-ingredient-have"
                                      : "pantry-command-ingredient-missing",
                                    excluded ? "pantry-command-ingredient-excluded" : "",
                                    clickable ? "pantry-command-ingredient-clickable" : "",
                                  ]
                                    .filter(Boolean)
                                    .join(" ")}
                                  role={clickable ? "button" : undefined}
                                  tabIndex={clickable ? 0 : undefined}
                                  title={clickable ? (excluded ? "Click to include again" : "Click to skip") : undefined}
                                  onClick={clickable ? () => toggleExcludedIngredient(i, ri, ii) : undefined}
                                  onKeyDown={
                                    clickable
                                      ? (e) => {
                                          if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            toggleExcludedIngredient(i, ri, ii);
                                          }
                                        }
                                      : undefined
                                  }
                                >
                                  {ing.haveInInventory ? "✓" : "+"} {ing.name}
                                  {amount && <span className="pantry-command-ingredient-amount"> ({amount})</span>}
                                  {price > 0 && (
                                    <span className="pantry-command-ingredient-price"> ~${price.toFixed(2)}</span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                          <p className="pantry-command-recipe-total">
                            Estimated total: ~${totalPriceAud.toFixed(2)} AUD
                          </p>
                          {missingCount > 0 && (
                            <button
                              type="button"
                              className="pantry-details-toggle"
                              onClick={() => handleAddMissingIngredients(i, recipe, ri)}
                            >
                              + add {missingCount} missing ingredient{missingCount > 1 ? "s" : ""} to shopping
                              list
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {turn.result.message &&
                  !turn.result.answer &&
                  !(turn.result.actions && turn.result.actions.length > 0) && (
                    <p className="status-line">// {turn.result.message}</p>
                  )}

                {turn.result.actions && turn.result.actions.length > 0 && (
                  <div className="pantry-command-actions">
                    {turn.actionsStatus === "done" ? (
                      // Collapsed to a single line once applied - the
                      // per-action cards (view mutation, remove) were only
                      // ever useful before confirming, and stayed expanded
                      // afterward for no reason.
                      <p className="pantry-command-turn-done">
                        ✓ Added {turn.result.actions.length} item
                        {turn.result.actions.length > 1 ? "s" : ""}
                      </p>
                    ) : turn.actionsStatus === "cancelled" ? (
                      <p className="pantry-command-turn-done">Cancelled</p>
                    ) : (
                      <>
                        {turn.result.message && <p className="status-line">// {turn.result.message}</p>}
                        {turn.result.actions.map((action, ai) => (
                          <div className="pantry-command-action" key={ai}>
                            <div className="pantry-command-action-row">
                              <p className="pantry-command-action-summary">{action.summary}</p>
                              <span className="pantry-command-action-controls">
                                <button
                                  type="button"
                                  className="pantry-details-toggle"
                                  onClick={() => toggleExpandedAction(i, ai)}
                                >
                                  {turn.expandedActions.has(ai) ? "− hide mutation" : "+ view mutation"}
                                </button>
                                <button
                                  type="button"
                                  className="pantry-shopping-remove-btn"
                                  onClick={() => removeAction(i, ai)}
                                  disabled={turn.actionsStatus === "confirming"}
                                  aria-label={`Remove "${action.summary}" from this batch`}
                                  title="Remove this action"
                                >
                                  ✕
                                </button>
                              </span>
                            </div>
                            {turn.expandedActions.has(ai) && (
                              <pre className="pantry-command-mutation">
                                {formatMutationPreview(action.mutationName, action.argsJson)}
                              </pre>
                            )}
                          </div>
                        ))}
                        {turn.actionsError && <p className="status-line">// {turn.actionsError}</p>}
                        <div className="pantry-modal-actions">
                          <button
                            type="button"
                            className="pantry-details-toggle"
                            onClick={() => updateAssistantTurn(i, { actionsStatus: "cancelled" })}
                            disabled={turn.actionsStatus === "confirming"}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="run-btn"
                            onClick={() => confirmActions(i, turn.result.actions!)}
                            disabled={turn.actionsStatus === "confirming"}
                          >
                            {turn.actionsStatus === "confirming" ? "Applying…" : "Confirm"}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="pantry-command-form">
        <textarea
          ref={textareaRef}
          className="form-input pantry-command-input"
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder='"Add 2L milk to the fridge" or "what&apos;s expiring soon?"'
          disabled={thinking}
          maxLength={200}
          rows={1}
        />
        <button className="run-btn" type="submit" disabled={thinking || !input.trim()}>
          {thinking ? "Thinking…" : "Ask"}
        </button>
      </form>

      {submitError && <p className="status-line">// {submitError}</p>}
    </section>
  );
}
