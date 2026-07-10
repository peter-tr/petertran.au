import { getAnthropicClient } from "@shared/anthropic-client";
import { assertAiNotRateLimited } from "../util/ai-rate-limit";
import type { InventoryItem, ShoppingListEntry } from "../../resolvers/resolvers";

const MAX_INPUT_LENGTH = 200;
const MAX_HISTORY_MESSAGES = 20;

export interface ConversationMessage {
  role: string;
  content: string;
}

type RawActionType =
  | "RECORD_PURCHASE"
  | "UPDATE_INVENTORY_ITEM"
  | "REMOVE_INVENTORY_ITEM"
  | "ADD_TO_SHOPPING_LIST"
  | "REMOVE_FROM_SHOPPING_LIST";

type RawFlag = "STAPLE" | "LOW_PRIORITY" | "NEARLY_EMPTY";

interface RawAction {
  type: RawActionType;
  summary: string;
  itemId: string | null;
  name: string | null;
  location: "FRIDGE" | "FREEZER" | "PANTRY" | null;
  category: string | null;
  quantity: number | null;
  unit: string | null;
  price: number | null;
  purchasedAt: string | null;
  expiresAt: string | null;
  // Booleans-to-set/clear are expressed as two plain (non-nullable) enum
  // arrays rather than one anyOf-typed field per flag - Anthropic's
  // structured-output schema caps the number of union/nullable-typed
  // parameters at 16, and this app was already close to that limit before
  // lowPriority/nearlyEmpty existed. A plain array isn't a union type, so
  // this keeps 3 flags (staple/lowPriority/nearlyEmpty) at the cost of only
  // 2 schema slots instead of 3, with room to add more flags later.
  flagsSet: RawFlag[];
  flagsClear: RawFlag[];
  note: string | null;
}

interface RawRecipeIngredient {
  name: string;
  amount: string | null;
  haveInInventory: boolean;
  itemId: string | null;
  // Non-nullable (0 = "not cleanly scalable"), not anyOf - see the comment
  // on RawAction.flagsSet for why this schema stays clear of Anthropic's
  // union-typed-parameter budget wherever a sentinel value works instead.
  quantity: number;
  estimatedPriceAud: number;
}

interface RawRecipe {
  name: string;
  description: string | null;
  ingredients: RawRecipeIngredient[];
  baseServings: number;
  caloriesPerServing: number;
  proteinGPerServing: number;
  carbsGPerServing: number;
  fatGPerServing: number;
}

interface RawParseResult {
  mode: "answer" | "actions" | "recipes" | "unclear";
  answer: string | null;
  answerItems: string[];
  actions: RawAction[];
  recipes: RawRecipe[];
  message: string | null;
}

export interface ProposedAction {
  type: RawActionType;
  summary: string;
  mutationName: string;
  argsJson: string;
}

export interface RecipeIngredient {
  name: string;
  amount: string | null;
  haveInInventory: boolean;
  itemId: string | null;
  quantity: number;
  estimatedPriceAud: number;
}

export interface RecipeSuggestion {
  name: string;
  description: string | null;
  ingredients: RecipeIngredient[];
  baseServings: number;
  caloriesPerServing: number;
  proteinGPerServing: number;
  carbsGPerServing: number;
  fatGPerServing: number;
}

export interface ParsedCommandResult {
  answer: string | null;
  answerItems: string[] | null;
  actions: ProposedAction[] | null;
  recipes: RecipeSuggestion[] | null;
  message: string | null;
}

function formatInventoryForPrompt(inventory: InventoryItem[]): string {
  if (inventory.length === 0) return "(empty - no items currently tracked)";
  return inventory
    .map(
      (i) =>
        `- id=${i.id} name="${i.name}" category=${i.category ?? "none"} location=${i.location} quantity=${i.quantity} unit=${i.unit ?? "none"}${
          i.expiresAt ? ` expiresAt=${i.expiresAt}` : ""
        }`
    )
    .join("\n");
}

function formatShoppingListForPrompt(shoppingList: ShoppingListEntry[]): string {
  if (shoppingList.length === 0) return "(empty)";
  return shoppingList
    .map(
      (e) =>
        `- id=${e.id} name="${e.name}"${e.quantity != null ? ` quantity=${e.quantity} unit=${e.unit ?? "none"}` : " (no quantity set)"}`
    )
    .join("\n");
}

function buildSystemPrompt(
  inventory: InventoryItem[],
  shoppingList: ShoppingListEntry[],
  categories: string[]
): string {
  const today = new Date().toISOString().slice(0, 10);
  return `You interpret natural-language commands for a household pantry/fridge inventory tracker. Today's date is ${today}. Earlier turns of this conversation, if any, are provided as prior messages - use them for context.

Current inventory:
${formatInventoryForPrompt(inventory)}

Current shopping list:
${formatShoppingListForPrompt(shoppingList)}

Categories already in use: ${categories.length ? categories.join(", ") : "(none yet)"}

Decide what the input is and respond with exactly one of these four modes:

- "answer": the input is a read-only question (e.g. "what's expiring soon?", "how much milk do I have?"). Answer directly and concisely from the data above in the "answer" field, in plain conversational text - never invent data not shown above. If the answer is naturally a list of items (e.g. "what spices do I have?", "what's expiring soon?") - set "answer" to a short intro sentence (or leave it null if nothing more needs saying) and put one line per item in "answerItems", instead of writing the whole list out as prose in "answer".
- "actions": use this mode whenever ANY part of the input is clear enough to act on - even if only part of it is. Fill "actions" with one entry per clear change:
  - RECORD_PURCHASE: adding or buying a new or existing item. Always use this (never UPDATE_INVENTORY_ITEM) for "add X" / "bought X" phrasing, even if a similar item already exists - the system merges duplicates itself. Requires name, location (guess FRIDGE/FREEZER/PANTRY sensibly if not stated), and quantity (default 1 if not stated). Set purchasedAt to today's date (${today}) unless the input implies no purchase actually happened. Set "category" when you're confident of a good match - prefer reusing one of the categories already in use above if one fits (e.g. "garlic powder" -> "Spices" if that's already a category), otherwise invent a sensible new one; leave it null if genuinely unclear rather than guessing. "flagsSet"/"flagsClear" turn STAPLE/LOW_PRIORITY/NEARLY_EMPTY on or off - only include a flag in one of these two lists if the input actually says so (e.g. "add salt as low priority" -> flagsSet: ["LOW_PRIORITY"]); leave both lists empty otherwise.
  - UPDATE_INVENTORY_ITEM: correcting an EXISTING item's fields without it being a new purchase. Requires itemId matching one of the ids listed above exactly - never invent an id. Same category/flagsSet/flagsClear rules as RECORD_PURCHASE apply here too, only when the input actually asks to change them.
  - REMOVE_INVENTORY_ITEM: fully using up or getting rid of an existing item. Requires itemId matching one of the ids listed above exactly.
  - ADD_TO_SHOPPING_LIST: noting something is needed without it being in stock right now (e.g. "we're out of eggs", "need to buy bread", "add 1 kg of coffee beans to my shopping list"). Requires name. Set quantity/unit only if the input actually states an amount (e.g. "1 kg of coffee beans" -> quantity=1, unit="kg"); leave both null for a plain "buy this" with no amount. Set "note" only when there's a specific reason worth remembering (e.g. a recipe it's for) - leave it null for a plain add. If the name matches an item already on the shopping list (see the list above), this UPDATES that entry's quantity/unit/note rather than creating a duplicate - use it for that too, e.g. if the user gives an amount for something already listed.
  - REMOVE_FROM_SHOPPING_LIST: an item on the shopping list has been bought or is no longer needed. Requires itemId matching one of the shopping list ids listed above exactly.
  Always write a short, specific "summary" for each action describing exactly what will happen, e.g. "Add 2 L Milk to the fridge, bought today".
  If the input names multiple distinct items - separated by commas, "and", or just listed one after another, e.g. "I bought pasta, pesto and cheese" - create one separate action per item, each with its own name. Never combine several item names into a single action's name field (e.g. never "pasta pesto cheese" as one name) - if you're about to write more than two or three words into a "name" field, that's a sign you're merging items that should be split.
  If part of the request is too vague to act on safely (e.g. "and whatever else I need for X" without saying what), don't invent items to fill the gap and don't drop the whole request either - propose actions for the clear part, and use "message" to say what you left out and why, so the user can just ask again for that part specifically.
- "recipes": the input asks for a recipe or dish's ingredients (e.g. "ingredients for hotdog", "how do I make carbonara"), an open recommendation based on what's in stock (e.g. "what can I make?", "recommend something for dinner"), or a change to a recipe YOU already suggested earlier in this conversation (e.g. "can you incorporate mushrooms", "remove the salt and pepper", "make it vegetarian", "I have cinnamon already"). Fill "recipes" with 1-3 suggestions:
  - "amount": a realistic freeform quantity for that dish (e.g. "500g", "2 cloves", "to taste" - null only if genuinely not applicable).
  - "quantity": the leading number in "amount" ONLY when it's a single clean number (e.g. "2.5 cups" -> 2.5, "400g" -> 400, "2 cloves" -> 2) - the client uses this to scale amounts when the user changes serving count. Set it to 0 when "amount" is a range, "to taste", or otherwise not a single clean leading number (e.g. "6-8 medium" -> 0, "to taste" -> 0, "a pinch" -> 0) - never guess a number for these, 0 means "leave this one as-is when scaling."
  - "estimatedPriceAud": your best-effort estimate of current Australian grocery price, in AUD, for this ingredient at the "amount" listed - 0 only for genuinely negligible items (a pinch of salt).
  - "haveInInventory": set by matching against the current inventory above (set "itemId" to the matching id when true, else null) - UNLESS you're also proposing (in "actions" of this same response) to add this exact ingredient, in which case set it true anyway, anticipating that action succeeding rather than waiting for the next turn.
  For a NAMED dish, use your own general food knowledge for its usual ingredients/amounts regardless of what's in stock - this is the one case where listing specific items the user didn't explicitly name is correct, not a guess to avoid. For an OPEN recommendation with no dish named, prefer recipes that lean on what's already in inventory. For a REFINEMENT of an earlier recipe, return that same recipe's name and updated ingredient list with the change applied (added/removed/swapped ingredients) rather than a new, unrelated suggestion - the earlier recipe is in your own previous turn, look for it there; that prior turn's JSON may also include "currentServings"/"excludedIngredientIndexes" for it - keep the serving count as-is and don't re-suggest an excluded ingredient unless the input re-includes it.
  Also set "baseServings" (the serving count the amounts/nutrition below apply to - 1 unless the input asks for a specific number of people/servings) and per-serving "caloriesPerServing"/"proteinGPerServing"/"carbsGPerServing"/"fatGPerServing" (always your best-effort estimate from general nutritional knowledge, never a placeholder).
  If the input ALSO implies a real inventory change beyond just refining the recipe (e.g. "I have cinnamon already" - the user is telling you they own it, not just asking you to assume it) - ALSO fill "actions" in this same response with that change (typically RECORD_PURCHASE), exactly like "actions" mode would, in addition to "recipes". Recipes mode is not mutually exclusive with actions when the input does both.
- "unclear": use this only when NONE of the input maps to a question, a safe action, or a recipe request - it's empty, entirely unrelated to pantry/fridge/cooking, or too ambiguous throughout to act on at all (e.g. it names an item that doesn't clearly match anything above, or could mean more than one existing item). Explain briefly in "message" why, or what's ambiguous, or ask the specific clarifying question needed to proceed - never guess at an itemId you're not sure about.

Conversation rules:
- If the input reads like an answer to a clarifying question from your own previous turn (e.g. it just names a location, a quantity, or "shopping list"/"inventory" with little else) - combine it with that earlier turn to complete the original request, rather than treating it alone as a new, likely-unclear input.
- If a later part of the SAME input corrects or contradicts an earlier part of it (signalled by words like "sorry", "actually", "I mean", "no wait"), use the corrected/final detail and ignore the one it replaced - e.g. "add grape juice to the shopping list? Sorry, the inventory" means the inventory, full stop, not a report that it's already on the shopping list.

Rules:
- Never mention an id (the "id=..." values above) in "answer" or "message" text - those are internal, refer to items by name only when talking to the user.
- Never invent an itemId that isn't listed above.
- Never invent specific items the user didn't name in "actions" mode, even when asked to guess what they "might need" - that's exactly the kind of gap "actions" mode's "message" field is for. (This does not apply to "recipes" mode - see above.)
- If ambiguous which existing item is meant, leave that part out (via "unclear" if it's the whole request, or "message" if it's part of one) and ask for clarification rather than guessing.
- Quantities are plain numbers, dates are formatted YYYY-MM-DD.
- Only respond about this pantry/fridge inventory and cooking with it - refuse (via "unclear") anything else entirely unrelated.`;
}

// Exported so scripts/validate-schemas.ts can check it stays under
// Anthropic's limit on union/nullable-typed ("anyOf") parameters - see the
// comment on RawAction.flagsSet for why this schema uses flag arrays
// instead of one anyOf boolean per flag.
export const PARSE_COMMAND_SCHEMA = {
  type: "object",
  properties: {
    mode: { type: "string", enum: ["answer", "actions", "recipes", "unclear"] },
    answer: { anyOf: [{ type: "string" }, { type: "null" }] },
    answerItems: { type: "array", items: { type: "string" } },
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: [
              "RECORD_PURCHASE",
              "UPDATE_INVENTORY_ITEM",
              "REMOVE_INVENTORY_ITEM",
              "ADD_TO_SHOPPING_LIST",
              "REMOVE_FROM_SHOPPING_LIST",
            ],
          },
          summary: { type: "string" },
          itemId: { anyOf: [{ type: "string" }, { type: "null" }] },
          name: { anyOf: [{ type: "string" }, { type: "null" }] },
          location: { anyOf: [{ type: "string", enum: ["FRIDGE", "FREEZER", "PANTRY"] }, { type: "null" }] },
          category: { anyOf: [{ type: "string" }, { type: "null" }] },
          quantity: { anyOf: [{ type: "number" }, { type: "null" }] },
          unit: { anyOf: [{ type: "string" }, { type: "null" }] },
          price: { anyOf: [{ type: "number" }, { type: "null" }] },
          purchasedAt: { anyOf: [{ type: "string" }, { type: "null" }] },
          expiresAt: { anyOf: [{ type: "string" }, { type: "null" }] },
          flagsSet: { type: "array", items: { type: "string", enum: ["STAPLE", "LOW_PRIORITY", "NEARLY_EMPTY"] } },
          flagsClear: { type: "array", items: { type: "string", enum: ["STAPLE", "LOW_PRIORITY", "NEARLY_EMPTY"] } },
          note: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
        required: [
          "type",
          "summary",
          "itemId",
          "name",
          "location",
          "category",
          "quantity",
          "unit",
          "price",
          "purchasedAt",
          "expiresAt",
          "flagsSet",
          "flagsClear",
          "note",
        ],
        additionalProperties: false,
      },
    },
    recipes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { anyOf: [{ type: "string" }, { type: "null" }] },
          ingredients: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                amount: { anyOf: [{ type: "string" }, { type: "null" }] },
                haveInInventory: { type: "boolean" },
                itemId: { anyOf: [{ type: "string" }, { type: "null" }] },
                quantity: { type: "number" },
                estimatedPriceAud: { type: "number" },
              },
              required: ["name", "amount", "haveInInventory", "itemId", "quantity", "estimatedPriceAud"],
              additionalProperties: false,
            },
          },
          baseServings: { type: "integer" },
          caloriesPerServing: { type: "number" },
          proteinGPerServing: { type: "number" },
          carbsGPerServing: { type: "number" },
          fatGPerServing: { type: "number" },
        },
        required: [
          "name",
          "description",
          "ingredients",
          "baseServings",
          "caloriesPerServing",
          "proteinGPerServing",
          "carbsGPerServing",
          "fatGPerServing",
        ],
        additionalProperties: false,
      },
    },
    message: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
  required: ["mode", "answer", "answerItems", "actions", "recipes", "message"],
  additionalProperties: false,
} as const;

// The trusted boundary: Claude only supplies typed fields, this switch is
// the only code that decides which real mutation + args they become. The
// client never executes anything Claude wrote directly as GraphQL.
function flagValue(a: RawAction, flag: RawFlag): boolean | null {
  if (a.flagsSet.includes(flag)) return true;
  if (a.flagsClear.includes(flag)) return false;
  return null;
}

function toProposedAction(a: RawAction): ProposedAction | null {
  switch (a.type) {
    case "RECORD_PURCHASE": {
      if (!a.name || !a.location || a.quantity == null) return null;
      return {
        type: a.type,
        summary: a.summary,
        mutationName: "recordPurchase",
        argsJson: JSON.stringify({
          input: {
            name: a.name,
            location: a.location,
            category: a.category,
            quantity: a.quantity,
            unit: a.unit,
            price: a.price,
            purchasedAt: a.purchasedAt,
            expiresAt: a.expiresAt,
            isStaple: flagValue(a, "STAPLE"),
            lowPriority: flagValue(a, "LOW_PRIORITY"),
            nearlyEmpty: flagValue(a, "NEARLY_EMPTY"),
          },
        }),
      };
    }
    case "UPDATE_INVENTORY_ITEM": {
      if (!a.itemId) return null;
      const input: Record<string, unknown> = {};
      if (a.name != null) input.name = a.name;
      if (a.location != null) input.location = a.location;
      if (a.category != null) input.category = a.category;
      if (a.quantity != null) input.quantity = a.quantity;
      if (a.unit != null) input.unit = a.unit;
      if (a.price != null) input.price = a.price;
      if (a.purchasedAt != null) input.purchasedAt = a.purchasedAt;
      if (a.expiresAt != null) input.expiresAt = a.expiresAt;
      const isStaple = flagValue(a, "STAPLE");
      const lowPriority = flagValue(a, "LOW_PRIORITY");
      const nearlyEmpty = flagValue(a, "NEARLY_EMPTY");
      if (isStaple != null) input.isStaple = isStaple;
      if (lowPriority != null) input.lowPriority = lowPriority;
      if (nearlyEmpty != null) input.nearlyEmpty = nearlyEmpty;
      return {
        type: a.type,
        summary: a.summary,
        mutationName: "updateInventoryItem",
        argsJson: JSON.stringify({ id: a.itemId, input }),
      };
    }
    case "REMOVE_INVENTORY_ITEM": {
      if (!a.itemId) return null;
      return {
        type: a.type,
        summary: a.summary,
        mutationName: "removeInventoryItem",
        argsJson: JSON.stringify({ id: a.itemId }),
      };
    }
    case "ADD_TO_SHOPPING_LIST": {
      if (!a.name) return null;
      return {
        type: a.type,
        summary: a.summary,
        mutationName: "addToShoppingList",
        argsJson: JSON.stringify({ name: a.name, quantity: a.quantity, unit: a.unit, note: a.note }),
      };
    }
    case "REMOVE_FROM_SHOPPING_LIST": {
      if (!a.itemId) return null;
      return {
        type: a.type,
        summary: a.summary,
        mutationName: "removeFromShoppingList",
        argsJson: JSON.stringify({ id: a.itemId }),
      };
    }
  }
}

// Drops any action referencing an id that isn't actually in the current
// data - Claude was given the real ids and told never to invent one, but a
// hallucinated id must never reach the client as something confirmable.
function hasValidItemId(a: RawAction, inventoryIds: Set<string>, shoppingListIds: Set<string>): boolean {
  switch (a.type) {
    case "UPDATE_INVENTORY_ITEM":
    case "REMOVE_INVENTORY_ITEM":
      return !!a.itemId && inventoryIds.has(a.itemId);
    case "REMOVE_FROM_SHOPPING_LIST":
      return !!a.itemId && shoppingListIds.has(a.itemId);
    default:
      return true;
  }
}

// Shared by "actions" mode and the recipes-can-also-propose-actions case
// (see the "I have cinnamon already" rule) - both need the exact same
// hallucination guard + argsJson construction.
function buildActions(
  rawActions: RawAction[],
  inventoryIds: Set<string>,
  shoppingListIds: Set<string>
): { actions: ProposedAction[] | null; droppedCount: number } {
  const validRaw = rawActions.filter((a) => hasValidItemId(a, inventoryIds, shoppingListIds));
  const droppedCount = rawActions.length - validRaw.length;
  const actions = validRaw.map(toProposedAction).filter((a): a is ProposedAction => a !== null);
  return { actions: actions.length ? actions : null, droppedCount };
}

// Same hallucination guard as actions, applied to recipe ingredients: a
// "haveInInventory: true" claim only survives if it points at a real id.
function sanitizeRecipes(recipes: RawRecipe[], inventoryIds: Set<string>): RecipeSuggestion[] {
  return recipes.map((r) => ({
    name: r.name,
    description: r.description,
    baseServings: r.baseServings > 0 ? r.baseServings : 1,
    caloriesPerServing: r.caloriesPerServing,
    proteinGPerServing: r.proteinGPerServing,
    carbsGPerServing: r.carbsGPerServing,
    fatGPerServing: r.fatGPerServing,
    ingredients: r.ingredients.map((ing) => {
      // haveInInventory can be legitimately true here even without a
      // matching itemId, when the model is anticipating an action in this
      // same response succeeding (see the "I have cinnamon already" rule
      // in the prompt) - only an itemId claim needs the hallucination
      // guard, not the flag itself.
      const validId = !!ing.itemId && inventoryIds.has(ing.itemId);
      return {
        name: ing.name,
        amount: ing.amount,
        haveInInventory: ing.haveInInventory,
        itemId: validId ? ing.itemId : null,
        quantity: ing.quantity,
        estimatedPriceAud: ing.estimatedPriceAud,
      };
    }),
  }));
}

export async function parseCommand(
  input: string,
  history: ConversationMessage[],
  inventory: InventoryItem[],
  shoppingList: ShoppingListEntry[],
  categories: string[],
  sourceIp: string | undefined
): Promise<ParsedCommandResult> {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("input is required.");
  if (trimmed.length > MAX_INPUT_LENGTH) {
    throw new Error(`Keep the command under ${MAX_INPUT_LENGTH} characters.`);
  }

  await assertAiNotRateLimited(sourceIp);

  const client = await getAnthropicClient();
  const priorMessages = history.slice(-MAX_HISTORY_MESSAGES).map((m) => ({
    role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
    content: m.content,
  }));
  const response = await client.messages.parse({
    model: "claude-haiku-4-5",
    max_tokens: 1536,
    system: buildSystemPrompt(inventory, shoppingList, categories),
    messages: [...priorMessages, { role: "user", content: trimmed }],
    output_config: { format: { type: "json_schema", schema: PARSE_COMMAND_SCHEMA } },
  });

  const parsed = response.parsed_output as RawParseResult | null;
  if (!parsed) throw new Error("Claude didn't return a valid response - try rephrasing.");

  if (parsed.mode === "answer") {
    return {
      answer: parsed.answer,
      answerItems: parsed.answerItems.length ? parsed.answerItems : null,
      actions: null,
      recipes: null,
      message: null,
    };
  }

  const inventoryIds = new Set(inventory.map((i) => i.id));
  const shoppingListIds = new Set(shoppingList.map((e) => e.id));

  if (parsed.mode === "recipes") {
    // Recipes mode isn't mutually exclusive with actions - a follow-up like
    // "I have cinnamon already" both updates the recipe and needs a real
    // inventory action, so any actions the model included ride along too.
    const { actions, droppedCount } = buildActions(parsed.actions, inventoryIds, shoppingListIds);
    return {
      answer: null,
      answerItems: null,
      actions,
      recipes: sanitizeRecipes(parsed.recipes, inventoryIds),
      message:
        parsed.message ??
        (droppedCount > 0 ? "Some of what you asked couldn't be matched to a real item and was skipped." : null),
    };
  }

  if (parsed.mode === "unclear") {
    return {
      answer: null,
      answerItems: null,
      actions: null,
      recipes: null,
      message: parsed.message ?? "I couldn't understand that - try rephrasing.",
    };
  }

  const { actions, droppedCount } = buildActions(parsed.actions, inventoryIds, shoppingListIds);

  if (!actions) {
    return {
      answer: null,
      answerItems: null,
      actions: null,
      recipes: null,
      message:
        droppedCount > 0
          ? "Couldn't find one of the items you mentioned - it may have already been removed or renamed."
          : "I couldn't turn that into an action - try rephrasing.",
    };
  }

  return {
    answer: null,
    answerItems: null,
    actions,
    recipes: null,
    message:
      droppedCount > 0 ? "Some of what you asked couldn't be matched to a real item and was skipped." : null,
  };
}
