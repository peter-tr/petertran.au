import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  runPantryQuery,
  PARSE_COMMAND_QUERY,
  PANTRY_ACTION_MUTATIONS,
  CHECK_PRICE_NOW_MUTATION,
  PantryActionType,
  type CheckPriceNowResult,
  type ConversationMessage,
  type InventoryItem,
  type ParseCommandResult,
  type ParsedCommand,
  type ProposedAction,
  type RecipeIngredient,
  type RecipeSuggestion,
} from "../api";
import { scaleAmount, scalePrice, checkSufficiency } from "../lib/recipeScaling";
import { formatDebugInfo } from "../lib/priceDisplay";

type ActionsStatus = "pending" | "confirming" | "done" | "cancelled";

// Tracked separately from actionsStatus - a price check isn't an action the
// user is confirming before it happens, it's a single already-agreed-to
// live lookup.
type PriceCheckStatus = "idle" | "checking" | "done" | "error";

interface UserTurn {
  id: string;
  role: "user";
  text: string;
}

interface AssistantTurn {
  id: string;
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
  priceCheckStatus: PriceCheckStatus;
}

type Turn = UserTurn | AssistantTurn;

interface PantryCommandBarProps {
  items: InventoryItem[];
  onChanged: () => Promise<void>;
  nerdMode: boolean;
}

// Only the last few turns are sent back as context on each call - a
// personal pantry's inventory/shopping-list state is small, but there's no
// reason to let token cost grow unbounded across a very long conversation.
const MAX_HISTORY_TURNS = 10;

// Turns are only ever appended, but each one carries local state (servings,
// exclusions, dismissals) that has to stay attached to it across renders -
// so they get a real identity rather than being keyed on array position.
let turnSeq = 0;

function nextTurnId(): string {
  turnSeq += 1;

  return `turn-${turnSeq}`;
}

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
      // Only a cleanly-scalable amount (ing.quantity > 0) splits into real
      // quantity/unit fields - same rule scaleAmount itself uses. Anything
      // else ("to taste", a range) has nothing safe to parse out, so it
      // stays freeform text in the note, same as before.
      const scaledQuantityMatch = ing.quantity > 0 ? amount?.match(/^([\d.]+)/) : null;
      const quantity = scaledQuantityMatch ? Number(scaledQuantityMatch[1]) : null;
      const unit = quantity !== null ? amount!.replace(/^[\d.]+\s*/, "").trim() || null : null;
      const amountSuffix = amount ? ` (${amount})` : "";

      let note = `For: ${recipe.name}`;
      if (quantity === null && amount) note = `${amount} - for: ${recipe.name}`;

      return {
        type: PantryActionType.AddToShoppingList,
        summary: `Add "${ing.name}"${amountSuffix} to the shopping list (for: ${recipe.name})`,
        mutationName: "addToShoppingList",
        argsJson: JSON.stringify({
          name: ing.name,
          quantity,
          unit,
          note,
          recipeTag: recipe.name,
        }),
        estimatedPriceAud: ing.estimatedPriceAud,
      };
    });
}

// Recipe amounts/nutrition are calibrated to `baseServings` - this looks up
// whatever the user has set the stepper to (default: baseServings itself).
function servingsFor(turn: AssistantTurn, recipeIndex: number, recipe: RecipeSuggestion): number {
  return turn.recipeServings[recipeIndex] ?? recipe.baseServings;
}

function excludedIndexesFor(turn: AssistantTurn, recipe: RecipeSuggestion, recipeIndex: number): number[] {
  return recipe.ingredients
    .map((_, ii) => ii)
    .filter((ii) => turn.excludedIngredients.has(`${recipeIndex}-${ii}`));
}

// Recipe turns carry client-only state (servings, excluded ingredients)
// the server never saw - merged in here so the AI can tell that a follow-up
// like "remove the salt" already happened, and what serving count is
// currently showing. Dismissed recipes are dropped entirely (not just
// flagged) - once the user clicks "✕" on one, it should be as if it was
// never suggested for the rest of the conversation.
function withClientRecipeState(turn: AssistantTurn) {
  const recipes = turn.result.recipes ?? [];

  return {
    ...turn.result,
    recipes: recipes
      .map((recipe, ri) => ({
        ...recipe,
        currentServings: servingsFor(turn, ri, recipe),
        excludedIngredientIndexes: excludedIndexesFor(turn, recipe, ri),
      }))
      .filter((_, ri) => !turn.dismissedRecipes.has(ri)),
  };
}

// Feeds Claude back its own prior structured output as the assistant's side
// of the conversation, so a reply like "shopping list, 1 bottle" can
// complete an earlier clarifying question instead of being parsed alone as
// a new, likely-unclear input.
function toHistoryMessage(turn: Turn): ConversationMessage {
  if (turn.role === "user") return { role: "user", content: turn.text };

  const content = turn.result.recipes ? withClientRecipeState(turn) : turn.result;

  return { role: "assistant", content: JSON.stringify(content) };
}

// Fine-grained control: drop a single proposed action from the batch
// without cancelling the whole thing.
function withoutAction(turn: Turn, actionIndex: number): Turn {
  if (turn.role !== "assistant" || !turn.result.actions) return turn;

  return {
    ...turn,
    result: { ...turn.result, actions: turn.result.actions.filter((_, ai) => ai !== actionIndex) },
  };
}

function ingredientIcon(haveInInventory: boolean, insufficient: boolean): string {
  if (!haveInInventory) return "+";

  return insufficient ? "△" : "✓";
}

// Only ever shown on an ingredient that can actually be clicked off.
function ingredientTitle(excluded: boolean, insufficient: boolean): string {
  if (excluded) return "Click to include again";
  if (insufficient) return "You don't have enough at this serving count - click to skip";

  return "Click to skip";
}

interface CapabilityGroup {
  label: string;
  description: string;
  examples: string[];
}

// Grouped (rather than one flat list) so each capability gets its own label
// color, and each example is its own clickable button that fills the input
// below instead of just being inert copy.
const CAPABILITIES: CapabilityGroup[] = [
  {
    label: "Recipes",
    description: "Ask for a recipe from what you have.",
    examples: ["what can I make with chicken?", "how do I make carbonara"],
  },
  {
    label: "Inventory",
    description: "Add, update, or remove items.",
    examples: ["add 2L milk to the fridge", "used up the eggs"],
  },
  {
    label: "Shopping list",
    description: "Food or household items.",
    examples: ["add toothbrush to my shopping list"],
  },
  {
    label: "Flags",
    description: "Staple, low priority, or nearly empty.",
    examples: ["mark rice as low priority"],
  },
  {
    label: "Follow-ups",
    description: "It remembers the conversation.",
    examples: ["make it vegetarian", "remove the salt"],
  },
];

interface PriceCheckOfferProps {
  status: PriceCheckStatus;
  onCheck: () => void;
}

// The one-off live Coles check the user explicitly opted into from the
// "want me to check now?" offer - a single real Anthropic call, so it takes
// a few seconds, not the instant round-trip everything else here is.
function PriceCheckOffer({ status, onCheck }: Readonly<PriceCheckOfferProps>) {
  if (status === "done") {
    return <p className="pantry-command-price-offer">Checked - see the updated price on the list below.</p>;
  }

  if (status === "error") {
    return (
      <p className="pantry-command-price-offer">
        Couldn&apos;t check just now.{" "}
        <button type="button" className="run-btn" onClick={onCheck}>
          Try again
        </button>
      </p>
    );
  }

  return (
    <p className="pantry-command-price-offer">
      <button type="button" className="run-btn" disabled={status === "checking"} onClick={onCheck}>
        {status === "checking" ? "Checking…" : "Check Coles now"}
      </button>
    </p>
  );
}

interface IngredientRowProps {
  ingredient: RecipeIngredient;
  ratio: number;
  items: InventoryItem[];
  excluded: boolean;
  onToggle: () => void;
}

function IngredientRow({ ingredient, ratio, items, excluded, onToggle }: Readonly<IngredientRowProps>) {
  const matched = ingredient.itemId ? (items.find((it) => it.id === ingredient.itemId) ?? null) : null;
  const sufficiency = ingredient.haveInInventory
    ? checkSufficiency(ingredient.amount, ingredient.quantity, ratio, matched)
    : "unknown";
  const insufficient = sufficiency === "insufficient";
  // Only something you're short of is worth clicking off - the rest was
  // never going on the shopping list anyway.
  const clickable = !ingredient.haveInInventory || insufficient;
  const amount = scaleAmount(ingredient.amount, ingredient.quantity, ratio);
  const price = scalePrice(ingredient.estimatedPriceAud, ingredient.quantity, ratio);
  const className = [
    ingredient.haveInInventory ? "pantry-command-ingredient-have" : "pantry-command-ingredient-missing",
    insufficient ? "pantry-command-ingredient-insufficient" : "",
    excluded ? "pantry-command-ingredient-excluded" : "",
    clickable ? "pantry-command-ingredient-clickable" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const label = (
    <>
      {ingredientIcon(ingredient.haveInInventory, insufficient)} {ingredient.name}
      {amount && <span className="pantry-command-ingredient-amount"> ({amount})</span>}
      {insufficient && matched && (
        <span className="pantry-command-ingredient-amount">
          {" "}
          - have {matched.quantity}
          {matched.unit ? ` ${matched.unit}` : ""}
        </span>
      )}
      {price > 0 && <span className="pantry-command-ingredient-price"> ~${price.toFixed(2)}</span>}
    </>
  );

  return (
    <li className={className}>
      {clickable ? (
        <button
          type="button"
          className="pantry-command-ingredient-btn"
          title={ingredientTitle(excluded, insufficient)}
          onClick={onToggle}
        >
          {label}
        </button>
      ) : (
        label
      )}
    </li>
  );
}

interface RecipeCardProps {
  recipe: RecipeSuggestion;
  turn: AssistantTurn;
  turnIndex: number;
  recipeIndex: number;
  items: InventoryItem[];
  onDismiss: (turnIndex: number, recipeIndex: number) => void;
  onSetServings: (turnIndex: number, recipeIndex: number, next: number) => void;
  onToggleIngredient: (turnIndex: number, recipeIndex: number, ingredientIndex: number) => void;
  onAddMissing: (turnIndex: number, recipe: RecipeSuggestion, recipeIndex: number) => void;
}

function RecipeCard({
  recipe,
  turn,
  turnIndex,
  recipeIndex,
  items,
  onDismiss,
  onSetServings,
  onToggleIngredient,
  onAddMissing,
}: Readonly<RecipeCardProps>) {
  const servings = servingsFor(turn, recipeIndex, recipe);
  const ratio = servings / recipe.baseServings;
  const missingCount = recipe.ingredients.filter(
    (ing, ii) =>
      isEffectivelyMissing(ing, ratio, items) && !turn.excludedIngredients.has(`${recipeIndex}-${ii}`)
  ).length;
  const totalPriceAud = recipe.ingredients.reduce(
    (sum, ing) => sum + scalePrice(ing.estimatedPriceAud, ing.quantity, ratio),
    0
  );

  return (
    <div className="pantry-command-recipe">
      <div className="pantry-command-recipe-header">
        <div className="pantry-command-recipe-title">
          <p className="pantry-command-recipe-name">{recipe.name}</p>
          <button
            type="button"
            className="pantry-shopping-remove-btn"
            onClick={() => onDismiss(turnIndex, recipeIndex)}
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
            onClick={() => onSetServings(turnIndex, recipeIndex, servings - 1)}
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
            onClick={() => onSetServings(turnIndex, recipeIndex, servings + 1)}
          >
            +
          </button>
        </div>
      </div>
      {recipe.description && <p className="pantry-command-recipe-desc">{recipe.description}</p>}
      <p className="pantry-command-recipe-nutrition">
        {Math.round(recipe.caloriesPerServing)} kcal · {Math.round(recipe.proteinGPerServing)}g protein ·{" "}
        {Math.round(recipe.carbsGPerServing)}g carbs · {Math.round(recipe.fatGPerServing)}g fat
      </p>
      <ul className="pantry-command-recipe-ingredients">
        {recipe.ingredients.map((ing, ii) => (
          <IngredientRow
            key={ing.name}
            ingredient={ing}
            ratio={ratio}
            items={items}
            excluded={turn.excludedIngredients.has(`${recipeIndex}-${ii}`)}
            onToggle={() => onToggleIngredient(turnIndex, recipeIndex, ii)}
          />
        ))}
      </ul>
      <p className="pantry-command-recipe-total">Estimated total: ~${totalPriceAud.toFixed(2)} AUD</p>
      {missingCount > 0 && (
        <button
          type="button"
          className="pantry-details-toggle"
          onClick={() => onAddMissing(turnIndex, recipe, recipeIndex)}
        >
          + add {missingCount} missing ingredient{missingCount > 1 ? "s" : ""} to shopping list
        </button>
      )}
    </div>
  );
}

type RecipeListProps = Omit<RecipeCardProps, "recipe" | "recipeIndex">;

function RecipeList({ turn, turnIndex, items, ...handlers }: Readonly<RecipeListProps>) {
  const recipes = turn.result.recipes ?? [];

  return (
    <div className="pantry-command-recipes">
      {recipes.every((_, ri) => turn.dismissedRecipes.has(ri)) && (
        <p className="pantry-command-turn-done">All suggestions dismissed.</p>
      )}
      {recipes.map((recipe, ri) =>
        turn.dismissedRecipes.has(ri) ? null : (
          <RecipeCard
            key={recipe.name}
            recipe={recipe}
            recipeIndex={ri}
            turn={turn}
            turnIndex={turnIndex}
            items={items}
            {...handlers}
          />
        )
      )}
    </div>
  );
}

interface ProposedActionsPanelProps {
  turn: AssistantTurn;
  turnIndex: number;
  actions: ProposedAction[];
  onRemoveAction: (turnIndex: number, actionIndex: number) => void;
  onCancel: (turnIndex: number) => void;
  onConfirm: (turnIndex: number, actions: ProposedAction[]) => void;
}

function ProposedActionsPanel({
  turn,
  turnIndex,
  actions,
  onRemoveAction,
  onCancel,
  onConfirm,
}: Readonly<ProposedActionsPanelProps>) {
  // Collapsed to a single line once applied - the per-action cards were
  // only ever useful before confirming, and stayed expanded afterward for
  // no reason.
  if (turn.actionsStatus === "done") {
    return (
      <div className="pantry-command-actions">
        <p className="pantry-command-turn-done">
          ✓ Added {actions.length} item{actions.length > 1 ? "s" : ""}
        </p>
      </div>
    );
  }

  if (turn.actionsStatus === "cancelled") {
    return (
      <div className="pantry-command-actions">
        <p className="pantry-command-turn-done">Cancelled</p>
      </div>
    );
  }

  const confirming = turn.actionsStatus === "confirming";

  return (
    <div className="pantry-command-actions">
      {turn.result.message && <p className="status-line">// {turn.result.message}</p>}
      {actions.map((action, ai) => (
        <div className="pantry-command-action" key={action.summary}>
          <div className="pantry-command-action-row">
            <p className="pantry-command-action-summary">
              {action.summary}
              {action.estimatedPriceAud !== null && (
                <span
                  className="pantry-command-action-estimate"
                  title="Rough estimate from Claude's own knowledge - not a live/confirmed price"
                >
                  {" "}
                  ~${action.estimatedPriceAud.toFixed(2)}
                </span>
              )}
            </p>
            <button
              type="button"
              className="pantry-shopping-remove-btn"
              onClick={() => onRemoveAction(turnIndex, ai)}
              disabled={confirming}
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
          onClick={() => onCancel(turnIndex)}
          disabled={confirming}
        >
          Cancel
        </button>
        <button
          type="button"
          className="run-btn"
          onClick={() => onConfirm(turnIndex, actions)}
          disabled={confirming}
        >
          {confirming ? "Applying…" : "Confirm"}
        </button>
      </div>
    </div>
  );
}

interface AssistantTurnViewProps {
  turn: AssistantTurn;
  turnIndex: number;
  items: InventoryItem[];
  nerdMode: boolean;
  // Recipes represent "the current suggestion we're iterating on" - only
  // the latest turn's render as live cards (see lastRecipesTurnIndex).
  showRecipes: boolean;
  onCheckPrice: (turnIndex: number, itemId: string, list: string) => void;
  onDismissRecipe: (turnIndex: number, recipeIndex: number) => void;
  onSetServings: (turnIndex: number, recipeIndex: number, next: number) => void;
  onToggleIngredient: (turnIndex: number, recipeIndex: number, ingredientIndex: number) => void;
  onAddMissing: (turnIndex: number, recipe: RecipeSuggestion, recipeIndex: number) => void;
  onRemoveAction: (turnIndex: number, actionIndex: number) => void;
  onCancelActions: (turnIndex: number) => void;
  onConfirmActions: (turnIndex: number, actions: ProposedAction[]) => void;
}

function AssistantTurnView({
  turn,
  turnIndex,
  items,
  nerdMode,
  showRecipes,
  onCheckPrice,
  onDismissRecipe,
  onSetServings,
  onToggleIngredient,
  onAddMissing,
  onRemoveAction,
  onCancelActions,
  onConfirmActions,
}: Readonly<AssistantTurnViewProps>) {
  const { result } = turn;
  const priceCheckItemId = result.offerPriceCheckItemId;
  const priceCheckList = result.offerPriceCheckList;
  const actions = result.actions ?? [];
  const hasRecipes = showRecipes && !!result.recipes && result.recipes.length > 0;

  return (
    <div className="pantry-command-turn-assistant">
      {result.answer && <p className="pantry-command-answer">{result.answer}</p>}

      {priceCheckItemId && priceCheckList && (
        <PriceCheckOffer
          status={turn.priceCheckStatus}
          onCheck={() => onCheckPrice(turnIndex, priceCheckItemId, priceCheckList)}
        />
      )}

      {result.answerItems && result.answerItems.length > 0 && (
        <ul className="pantry-command-answer-items">
          {result.answerItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}

      {hasRecipes && (
        <RecipeList
          turn={turn}
          turnIndex={turnIndex}
          items={items}
          onDismiss={onDismissRecipe}
          onSetServings={onSetServings}
          onToggleIngredient={onToggleIngredient}
          onAddMissing={onAddMissing}
        />
      )}

      {result.message && !result.answer && actions.length === 0 && (
        <p className="status-line">// {result.message}</p>
      )}

      {actions.length > 0 && (
        <ProposedActionsPanel
          turn={turn}
          turnIndex={turnIndex}
          actions={actions}
          onRemoveAction={onRemoveAction}
          onCancel={onCancelActions}
          onConfirm={onConfirmActions}
        />
      )}

      {nerdMode && <p className="pantry-nerd-debug-info">{formatDebugInfo(result.debugInfo)}</p>}
    </div>
  );
}

export default function PantryCommandBar({ items, onChanged, nerdMode }: Readonly<PantryCommandBarProps>) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [thinking, setThinking] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);

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
  // Keyed off `input` itself (not just the change handler) so a programmatic
  // fill - like clicking an example prompt - resizes the box too.
  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
  }, [input]);

  // Fills the input from a clicked example without submitting it - the user
  // still reviews/edits and hits Enter themselves, same as if they'd typed it.
  function fillExample(example: string) {
    setInput(example);
    textareaRef.current?.focus();
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

  function removeAction(turnIndex: number, actionIndex: number) {
    setTurns((prev) => prev.map((t, i) => (i === turnIndex ? withoutAction(t, actionIndex) : t)));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const trimmed = input.trim();
    if (!trimmed || thinking) return;

    const history: ConversationMessage[] = turns.slice(-MAX_HISTORY_TURNS).map(toHistoryMessage);

    setTurns((prev) => [...prev, { id: nextTurnId(), role: "user", text: trimmed }]);
    setInput("");
    resetTextareaHeight();
    setThinking(true);
    setSubmitError(null);

    try {
      const data = await runPantryQuery<ParseCommandResult>(PARSE_COMMAND_QUERY, { input: trimmed, history });
      setTurns((prev) => [
        ...prev,
        {
          id: nextTurnId(),
          role: "assistant",
          result: data.parseCommand,
          actionsStatus: "pending",
          actionsError: null,
          excludedIngredients: new Set(),
          recipeServings: {},
          dismissedRecipes: new Set(),
          priceCheckStatus: "idle",
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

  function cancelActions(turnIndex: number) {
    updateAssistantTurn(turnIndex, { actionsStatus: "cancelled" });
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

  async function checkPriceNow(turnIndex: number, itemId: string, list: string) {
    updateAssistantTurn(turnIndex, { priceCheckStatus: "checking" });
    try {
      await runPantryQuery<CheckPriceNowResult>(CHECK_PRICE_NOW_MUTATION, { id: itemId, list });
      await onChanged();
      updateAssistantTurn(turnIndex, { priceCheckStatus: "done" });
    } catch {
      updateAssistantTurn(turnIndex, { priceCheckStatus: "error" });
    }
  }

  // Only the latest recipe turn renders as a live card, or a refinement
  // like "remove garlic" would appear to duplicate the card instead of
  // updating it. Older turns' answer/message/actions still render normally;
  // this only suppresses stale recipe cards.
  const lastRecipesTurnIndex = turns.reduce(
    (acc, t, i) => (t.role === "assistant" && t.result.recipes && t.result.recipes.length > 0 ? i : acc),
    -1
  );

  return (
    <section className="pantry-panel pantry-command-bar">
      <div className="pantry-panel-header">
        <h2 className="pantry-panel-title">
          Ask or tell it what to do{" "}
          <button
            type="button"
            className="pantry-info-btn"
            onClick={() => setShowInfo((v) => !v)}
            aria-label="What can I ask it to do?"
            aria-expanded={showInfo}
          >
            h
          </button>
        </h2>
        {turns.length > 0 && (
          <button type="button" className="pantry-details-toggle" onClick={clearConversation}>
            Clear
          </button>
        )}
      </div>

      {showInfo && (
        <div className="pantry-info-list">
          {CAPABILITIES.map((group, gi) => (
            <div className="pantry-info-group" key={group.label}>
              <div className="pantry-info-group-head">
                <span className={`pantry-info-label pantry-info-label-${gi % 3}`}>{group.label}</span>
                <span className="pantry-info-desc">{group.description}</span>
              </div>
              <div className="pantry-info-examples">
                {group.examples.map((example) => (
                  <button
                    key={example}
                    type="button"
                    className="pantry-info-example"
                    title="Click to fill the input below"
                    onClick={() => fillExample(example)}
                  >
                    “{example}”
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {(turns.length > 0 || thinking) && (
        <div className="pantry-command-turns">
          {turns.map((turn, i) =>
            turn.role === "user" ? (
              <p className="pantry-command-turn-user" key={turn.id}>
                {turn.text}
              </p>
            ) : (
              <AssistantTurnView
                key={turn.id}
                turn={turn}
                turnIndex={i}
                items={items}
                nerdMode={nerdMode}
                showRecipes={i === lastRecipesTurnIndex}
                onCheckPrice={checkPriceNow}
                onDismissRecipe={dismissRecipe}
                onSetServings={setServings}
                onToggleIngredient={toggleExcludedIngredient}
                onAddMissing={handleAddMissingIngredients}
                onRemoveAction={removeAction}
                onCancelActions={cancelActions}
                onConfirmActions={confirmActions}
              />
            )
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="pantry-command-form">
        <textarea
          ref={textareaRef}
          className="form-input pantry-command-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="What items do I have?"
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
