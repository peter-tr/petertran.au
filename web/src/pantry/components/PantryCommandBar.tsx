import { useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import {
  runPantryQuery,
  PARSE_COMMAND_QUERY,
  PANTRY_ACTION_MUTATIONS,
  type ConversationMessage,
  type InventoryItem,
  type ParseCommandResult,
  type ParsedCommand,
  type ProposedAction,
  type RecipeIngredient,
  type RecipeSuggestion,
} from "../api";
import { scaleAmount, scalePrice, checkSufficiency } from "../lib/recipeScaling";

type ActionsStatus = "pending" | "confirming" | "done" | "cancelled";

interface UserTurn {
  role: "user";
  text: string;
}

interface AssistantTurn {
  role: "assistant";
  result: ParsedCommand;
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
  // Recipe indexes the user has clicked "✕" on - hidden from the card list
  // and left out of the JSON sent back as conversation history, so a
  // follow-up like "make it vegetarian" can't accidentally apply to a
  // suggestion the user already said they're done with.
  dismissedRecipes: Set<number>;
}

type Turn = UserTurn | AssistantTurn;

interface PantryCommandBarProps {
  items: InventoryItem[];
  onChanged: () => Promise<void>;
}

// Only the last few turns are sent back as context on each call - a
// personal pantry's inventory/shopping-list state is small, but there's no
// reason to let token cost grow unbounded across a very long conversation.
const MAX_HISTORY_TURNS = 10;

// haveInInventory only ever means "this ingredient exists somewhere in
// inventory", set once by the AI - it's never re-checked as the servings
// stepper scales the required amount up, so a "have" ingredient can end up
// silently short (28 servings needing 14 onions when you own 2). This
// treats "have, but not enough at the current serving count" the same as
// "missing" for both display and the shopping-list batch, falling back to
// the AI's flag as-is whenever the comparison can't be made safely.
function isEffectivelyMissing(ing: RecipeIngredient, ratio: number, items: InventoryItem[]): boolean {
  if (!ing.haveInInventory) return true;
  const matched = ing.itemId ? (items.find((i) => i.id === ing.itemId) ?? null) : null;
  return checkSufficiency(ing.amount, ing.quantity, ratio, matched) === "insufficient";
}

// Turns a recipe's missing (or insufficient) ingredients into the same
// {mutationName, argsJson} shape parseCommand itself produces - no extra AI
// call, this is just client-side synthesis feeding the exact same
// confirm/preview UI. `excluded` holds "recipeIndex-ingredientIndex" keys
// the user clicked off. `ratio` scales each ingredient's amount to whatever
// servings the recipe card is currently showing, so the shopping-list note
// reflects what's actually needed rather than always the recipe's base
// amount.
function buildRecipeShoppingActions(
  recipe: RecipeSuggestion,
  recipeIndex: number,
  excluded: Set<string>,
  ratio: number,
  items: InventoryItem[]
): ProposedAction[] {
  return recipe.ingredients
    .filter((ing, ii) => isEffectivelyMissing(ing, ratio, items) && !excluded.has(`${recipeIndex}-${ii}`))
    .map((ing) => {
      const amount = scaleAmount(ing.amount, ing.quantity, ratio);
      const note = amount ? `${amount} - for: ${recipe.name}` : `For: ${recipe.name}`;
      return {
        type: "ADD_TO_SHOPPING_LIST",
        summary: `Add "${ing.name}"${amount ? ` (${amount})` : ""} to the shopping list (for: ${recipe.name})`,
        mutationName: "addToShoppingList",
        argsJson: JSON.stringify({
          name: ing.name,
          quantity: null,
          unit: null,
          note,
          recipeTag: recipe.name,
        }),
      };
    });
}

// Recipe amounts/nutrition are calibrated to `baseServings` - this looks up
// whatever the user has set the stepper to (default: baseServings itself).
function servingsFor(turn: AssistantTurn, recipeIndex: number, recipe: RecipeSuggestion): number {
  return turn.recipeServings[recipeIndex] ?? recipe.baseServings;
}

export default function PantryCommandBar({ items, onChanged }: PantryCommandBarProps) {
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

  // Fine-grained control: drop a single proposed action from the batch
  // without cancelling the whole thing.
  function removeAction(turnIndex: number, actionIndex: number) {
    setTurns((prev) =>
      prev.map((t, i) => {
        if (i !== turnIndex || t.role !== "assistant" || !t.result.actions) return t;
        return {
          ...t,
          result: { ...t.result, actions: t.result.actions.filter((_, ai) => ai !== actionIndex) },
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
    // count is currently showing. Dismissed recipes are dropped entirely
    // (not just flagged) - once the user clicks "✕" on one, it should be as
    // if it was never suggested for the rest of the conversation.
    const history: ConversationMessage[] = turns.slice(-MAX_HISTORY_TURNS).map((t) => {
      if (t.role === "user") return { role: "user", content: t.text };
      const content = t.result.recipes
        ? {
            ...t.result,
            recipes: t.result.recipes
              .map((r, ri) => ({
                ...r,
                currentServings: servingsFor(t, ri, r),
                excludedIngredientIndexes: r.ingredients
                  .map((_, ii) => ii)
                  .filter((ii) => t.excludedIngredients.has(`${ri}-${ii}`)),
              }))
              .filter((_, ri) => !t.dismissedRecipes.has(ri)),
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
          actionsStatus: "pending",
          actionsError: null,
          excludedIngredients: new Set(),
          recipeServings: {},
          dismissedRecipes: new Set(),
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

  function dismissRecipe(turnIndex: number, recipeIndex: number) {
    setTurns((prev) =>
      prev.map((t, i) => {
        if (i !== turnIndex || t.role !== "assistant") return t;
        return { ...t, dismissedRecipes: new Set(t.dismissedRecipes).add(recipeIndex) };
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
    const actions = buildRecipeShoppingActions(recipe, recipeIndex, turn.excludedIngredients, ratio, items);
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

      {(turns.length > 0 || thinking) && (
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
                    {turn.result.recipes.every((_, ri) => turn.dismissedRecipes.has(ri)) && (
                      <p className="pantry-command-turn-done">All suggestions dismissed.</p>
                    )}
                    {turn.result.recipes.map((recipe, ri) => {
                      if (turn.dismissedRecipes.has(ri)) return null;
                      const servings = servingsFor(turn, ri, recipe);
                      const ratio = servings / recipe.baseServings;
                      const missingCount = recipe.ingredients.filter(
                        (ing, ii) =>
                          isEffectivelyMissing(ing, ratio, items) &&
                          !turn.excludedIngredients.has(`${ri}-${ii}`)
                      ).length;
                      const totalPriceAud = recipe.ingredients.reduce(
                        (sum, ing) => sum + scalePrice(ing.estimatedPriceAud, ing.quantity, ratio),
                        0
                      );
                      return (
                        <div className="pantry-command-recipe" key={ri}>
                          <div className="pantry-command-recipe-header">
                            <div className="pantry-command-recipe-title">
                              <p className="pantry-command-recipe-name">{recipe.name}</p>
                              <button
                                type="button"
                                className="pantry-shopping-remove-btn"
                                onClick={() => dismissRecipe(i, ri)}
                                aria-label={`Dismiss "${recipe.name}"`}
                                title="Not interested in this one"
                              >
                                ✕
                              </button>
                            </div>
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
                            {Math.round(recipe.caloriesPerServing)} kcal ·{" "}
                            {Math.round(recipe.proteinGPerServing)}g protein ·{" "}
                            {Math.round(recipe.carbsGPerServing)}g carbs · {Math.round(recipe.fatGPerServing)}
                            g fat
                          </p>
                          <ul className="pantry-command-recipe-ingredients">
                            {recipe.ingredients.map((ing, ii) => {
                              const excluded = turn.excludedIngredients.has(`${ri}-${ii}`);
                              const matched = ing.itemId
                                ? (items.find((it) => it.id === ing.itemId) ?? null)
                                : null;
                              const sufficiency = ing.haveInInventory
                                ? checkSufficiency(ing.amount, ing.quantity, ratio, matched)
                                : "unknown";
                              const insufficient = sufficiency === "insufficient";
                              const clickable = !ing.haveInInventory || insufficient;
                              const amount = scaleAmount(ing.amount, ing.quantity, ratio);
                              const price = scalePrice(ing.estimatedPriceAud, ing.quantity, ratio);
                              const icon = !ing.haveInInventory ? "+" : insufficient ? "△" : "✓";
                              return (
                                <li
                                  key={ii}
                                  className={[
                                    ing.haveInInventory
                                      ? "pantry-command-ingredient-have"
                                      : "pantry-command-ingredient-missing",
                                    insufficient ? "pantry-command-ingredient-insufficient" : "",
                                    excluded ? "pantry-command-ingredient-excluded" : "",
                                    clickable ? "pantry-command-ingredient-clickable" : "",
                                  ]
                                    .filter(Boolean)
                                    .join(" ")}
                                  role={clickable ? "button" : undefined}
                                  tabIndex={clickable ? 0 : undefined}
                                  title={
                                    clickable
                                      ? excluded
                                        ? "Click to include again"
                                        : insufficient
                                          ? "You don't have enough at this serving count - click to skip"
                                          : "Click to skip"
                                      : undefined
                                  }
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
                                  {icon} {ing.name}
                                  {amount && (
                                    <span className="pantry-command-ingredient-amount"> ({amount})</span>
                                  )}
                                  {insufficient && matched && (
                                    <span className="pantry-command-ingredient-amount">
                                      {" "}
                                      - have {matched.quantity}
                                      {matched.unit ? ` ${matched.unit}` : ""}
                                    </span>
                                  )}
                                  {price > 0 && (
                                    <span className="pantry-command-ingredient-price">
                                      {" "}
                                      ~${price.toFixed(2)}
                                    </span>
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
                      // per-action cards were only ever useful before
                      // confirming, and stayed expanded afterward for no
                      // reason.
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
                            </div>
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
          placeholder='"What can I make with chicken?" or "Add toothbrush to my shopping list"'
          disabled={thinking}
          maxLength={200}
          rows={1}
        />
        <button className="run-btn pantry-command-submit" type="submit" disabled={thinking || !input.trim()}>
          {thinking ? <span className="pantry-spinner" aria-hidden="true" /> : "Ask"}
        </button>
      </form>

      {submitError && <p className="status-line">// {submitError}</p>}
    </section>
  );
}
