import { getAnthropicClient } from "@shared/anthropic-client";
import { assertAiNotRateLimited } from "../util/ai-rate-limit";
import type { InventoryItem, ShoppingListEntry } from "../../resolvers/resolvers";

const MAX_INPUT_LENGTH = 200;

type RawActionType =
  | "RECORD_PURCHASE"
  | "UPDATE_INVENTORY_ITEM"
  | "REMOVE_INVENTORY_ITEM"
  | "ADD_TO_SHOPPING_LIST"
  | "REMOVE_FROM_SHOPPING_LIST";

interface RawAction {
  type: RawActionType;
  summary: string;
  itemId: string | null;
  name: string | null;
  location: "FRIDGE" | "FREEZER" | "PANTRY" | null;
  quantity: number | null;
  unit: string | null;
  price: number | null;
  purchasedAt: string | null;
  expiresAt: string | null;
  isStaple: boolean | null;
}

interface RawParseResult {
  mode: "answer" | "actions" | "unclear";
  answer: string | null;
  actions: RawAction[];
  message: string | null;
}

export interface ProposedAction {
  type: RawActionType;
  summary: string;
  mutationName: string;
  argsJson: string;
}

export interface ParsedCommandResult {
  answer: string | null;
  actions: ProposedAction[] | null;
  message: string | null;
}

function formatInventoryForPrompt(inventory: InventoryItem[]): string {
  if (inventory.length === 0) return "(empty - no items currently tracked)";
  return inventory
    .map(
      (i) =>
        `- id=${i.id} name="${i.name}" location=${i.location} quantity=${i.quantity} unit=${i.unit ?? "none"}${
          i.expiresAt ? ` expiresAt=${i.expiresAt}` : ""
        }`
    )
    .join("\n");
}

function formatShoppingListForPrompt(shoppingList: ShoppingListEntry[]): string {
  if (shoppingList.length === 0) return "(empty)";
  return shoppingList.map((e) => `- id=${e.id} name="${e.name}"`).join("\n");
}

function buildSystemPrompt(inventory: InventoryItem[], shoppingList: ShoppingListEntry[]): string {
  const today = new Date().toISOString().slice(0, 10);
  return `You interpret natural-language commands for a household pantry/fridge inventory tracker. Today's date is ${today}.

Current inventory:
${formatInventoryForPrompt(inventory)}

Current shopping list:
${formatShoppingListForPrompt(shoppingList)}

Decide whether the input is a QUESTION (answerable from the data above) or an ACTION (a change to make), and respond with exactly one of these three modes:

- "answer": the input is a read-only question (e.g. "what's expiring soon?", "how much milk do I have?"). Answer directly and concisely from the data above in the "answer" field, in plain conversational text - never invent data not shown above.
- "actions": use this mode whenever ANY part of the input is clear enough to act on - even if only part of it is. Fill "actions" with one entry per clear change:
  - RECORD_PURCHASE: adding or buying a new or existing item. Always use this (never UPDATE_INVENTORY_ITEM) for "add X" / "bought X" phrasing, even if a similar item already exists - the system merges duplicates itself. Requires name, location (guess FRIDGE/FREEZER/PANTRY sensibly if not stated), and quantity (default 1 if not stated). Set purchasedAt to today's date (${today}) unless the input implies no purchase actually happened.
  - UPDATE_INVENTORY_ITEM: correcting an EXISTING item's fields without it being a new purchase. Requires itemId matching one of the ids listed above exactly - never invent an id.
  - REMOVE_INVENTORY_ITEM: fully using up or getting rid of an existing item. Requires itemId matching one of the ids listed above exactly.
  - ADD_TO_SHOPPING_LIST: noting something is needed without it being in stock right now (e.g. "we're out of eggs", "need to buy bread"). Requires name.
  - REMOVE_FROM_SHOPPING_LIST: an item on the shopping list has been bought or is no longer needed. Requires itemId matching one of the shopping list ids listed above exactly.
  Always write a short, specific "summary" for each action describing exactly what will happen, e.g. "Add 2 L Milk to the fridge, bought today".
  If part of the request is too vague to act on safely (e.g. "and whatever else I need for X" without saying what), don't invent items to fill the gap and don't drop the whole request either - propose actions for the clear part, and use "message" to say what you left out and why, so the user can just ask again for that part specifically.
- "unclear": use this only when NONE of the input maps to a question or a safe action - it's empty, entirely unrelated to pantry/fridge inventory, or too ambiguous throughout to act on at all (e.g. it names an item that doesn't clearly match anything above, or could mean more than one existing item). Explain briefly in "message" why, or what's ambiguous - never guess at an itemId you're not sure about.

Rules:
- Never invent an itemId that isn't listed above.
- Never invent specific items the user didn't name, even when asked to guess what they "might need" - that's exactly the kind of gap "actions" mode's "message" field is for.
- If ambiguous which existing item is meant, leave that part out (via "unclear" if it's the whole request, or "message" if it's part of one) and ask for clarification rather than guessing.
- Quantities are plain numbers, dates are formatted YYYY-MM-DD.
- Only respond about this pantry/fridge inventory - refuse (via "unclear") anything else, even food-adjacent requests like recipes or nutrition advice.`;
}

const PARSE_COMMAND_SCHEMA = {
  type: "object",
  properties: {
    mode: { type: "string", enum: ["answer", "actions", "unclear"] },
    answer: { anyOf: [{ type: "string" }, { type: "null" }] },
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
          quantity: { anyOf: [{ type: "number" }, { type: "null" }] },
          unit: { anyOf: [{ type: "string" }, { type: "null" }] },
          price: { anyOf: [{ type: "number" }, { type: "null" }] },
          purchasedAt: { anyOf: [{ type: "string" }, { type: "null" }] },
          expiresAt: { anyOf: [{ type: "string" }, { type: "null" }] },
          isStaple: { anyOf: [{ type: "boolean" }, { type: "null" }] },
        },
        required: [
          "type",
          "summary",
          "itemId",
          "name",
          "location",
          "quantity",
          "unit",
          "price",
          "purchasedAt",
          "expiresAt",
          "isStaple",
        ],
        additionalProperties: false,
      },
    },
    message: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
  required: ["mode", "answer", "actions", "message"],
  additionalProperties: false,
} as const;

// The trusted boundary: Claude only supplies typed fields, this switch is
// the only code that decides which real mutation + args they become. The
// client never executes anything Claude wrote directly as GraphQL.
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
            quantity: a.quantity,
            unit: a.unit,
            price: a.price,
            purchasedAt: a.purchasedAt,
            expiresAt: a.expiresAt,
            isStaple: a.isStaple,
          },
        }),
      };
    }
    case "UPDATE_INVENTORY_ITEM": {
      if (!a.itemId) return null;
      const input: Record<string, unknown> = {};
      if (a.name != null) input.name = a.name;
      if (a.location != null) input.location = a.location;
      if (a.quantity != null) input.quantity = a.quantity;
      if (a.unit != null) input.unit = a.unit;
      if (a.price != null) input.price = a.price;
      if (a.purchasedAt != null) input.purchasedAt = a.purchasedAt;
      if (a.expiresAt != null) input.expiresAt = a.expiresAt;
      if (a.isStaple != null) input.isStaple = a.isStaple;
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
        argsJson: JSON.stringify({ name: a.name }),
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

export async function parseCommand(
  input: string,
  inventory: InventoryItem[],
  shoppingList: ShoppingListEntry[],
  sourceIp: string | undefined
): Promise<ParsedCommandResult> {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("input is required.");
  if (trimmed.length > MAX_INPUT_LENGTH) {
    throw new Error(`Keep the command under ${MAX_INPUT_LENGTH} characters.`);
  }

  await assertAiNotRateLimited(sourceIp);

  const client = await getAnthropicClient();
  const response = await client.messages.parse({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    system: buildSystemPrompt(inventory, shoppingList),
    messages: [{ role: "user", content: trimmed }],
    output_config: { format: { type: "json_schema", schema: PARSE_COMMAND_SCHEMA } },
  });

  const parsed = response.parsed_output as RawParseResult | null;
  if (!parsed) throw new Error("Claude didn't return a valid response - try rephrasing.");

  if (parsed.mode === "answer") {
    return { answer: parsed.answer, actions: null, message: null };
  }

  if (parsed.mode === "unclear") {
    return {
      answer: null,
      actions: null,
      message: parsed.message ?? "I couldn't understand that - try rephrasing.",
    };
  }

  const inventoryIds = new Set(inventory.map((i) => i.id));
  const shoppingListIds = new Set(shoppingList.map((e) => e.id));

  const validRaw = parsed.actions.filter((a) => hasValidItemId(a, inventoryIds, shoppingListIds));
  const droppedCount = parsed.actions.length - validRaw.length;

  const actions = validRaw.map(toProposedAction).filter((a): a is ProposedAction => a !== null);

  if (actions.length === 0) {
    return {
      answer: null,
      actions: null,
      message:
        droppedCount > 0
          ? "Couldn't find one of the items you mentioned - it may have already been removed or renamed."
          : "I couldn't turn that into an action - try rephrasing.",
    };
  }

  return {
    answer: null,
    actions,
    message: droppedCount > 0 ? "Some of what you asked couldn't be matched to a real item and was skipped." : null,
  };
}
