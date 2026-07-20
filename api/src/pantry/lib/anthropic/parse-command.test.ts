import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InventoryItem } from "../../services/inventory";
import type { ShoppingListEntry } from "../../services/shopping-list";

const messagesParse = vi.fn();
const getAnthropicClient = vi.fn(async () => ({ messages: { parse: messagesParse } }));
const assertAiNotRateLimited = vi.fn(async () => undefined);

vi.mock("api-shared/anthropic-client", () => ({
  getAnthropicClient: () => getAnthropicClient(),
}));
vi.mock("api-shared/xray", () => ({
  traced: (_name: string, fn: () => unknown) => fn(),
  ANTHROPIC_API_SEGMENT_NAME: "Anthropic API",
}));
vi.mock("../util/ai-rate-limit", () => ({
  assertAiNotRateLimited: (ip: string | undefined) => assertAiNotRateLimited(ip),
}));

const { parseCommand } = await import("./parse-command");

function usage() {
  return { input_tokens: 100, output_tokens: 50 };
}

function inventoryItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: "inv-1",
    name: "Milk",
    category: "Dairy",
    location: "FRIDGE",
    quantity: 1,
    unit: "L",
    price: null,
    purchasedAt: null,
    expiresAt: null,
    isStaple: false,
    lowPriority: false,
    nearlyEmpty: false,
    trackPrice: false,
    lastKnownPrice: null,
    purchases: [],
    addedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function shoppingListEntry(overrides: Partial<ShoppingListEntry> = {}): ShoppingListEntry {
  return {
    id: "sl-1",
    name: "Eggs",
    quantity: 1,
    unit: "dozen",
    note: null,
    isStaple: false,
    category: null,
    recipeTag: null,
    urgent: false,
    trackPrice: false,
    lastKnownPrice: null,
    addedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// Base "raw" parsed_output shape (all fields required by RawParseResult) -
// tests spread over this so each only needs to specify what it cares about.
function rawResult(overrides: Record<string, unknown> = {}) {
  return {
    mode: "unclear",
    answer: null,
    answerItems: [],
    actions: [],
    recipes: [],
    message: null,
    offerPriceCheckItemId: "",
    offerPriceCheckList: "",
    ...overrides,
  };
}

function rawAction(overrides: Record<string, unknown> = {}) {
  return {
    type: "RECORD_PURCHASE",
    summary: "Add 2 L Milk to the fridge",
    itemId: null,
    name: "Milk",
    location: "FRIDGE",
    category: null,
    quantity: 2,
    unit: "L",
    price: null,
    purchasedAt: "2026-01-15",
    expiresAt: null,
    flagsSet: [],
    flagsClear: [],
    note: null,
    estimatedPriceAud: 0,
    ...overrides,
  };
}

async function run(
  input: string,
  parsed: unknown,
  opts: { inventory?: InventoryItem[]; shoppingList?: ShoppingListEntry[]; history?: unknown[] } = {}
) {
  messagesParse.mockResolvedValue({ usage: usage(), parsed_output: parsed });

  return parseCommand(
    input,
    (opts.history as never) ?? [],
    opts.inventory ?? [],
    opts.shoppingList ?? [],
    ["Dairy"],
    "1.2.3.4",
    undefined
  );
}

describe("parseCommand - input validation", () => {
  beforeEach(() => {
    messagesParse.mockReset();
    assertAiNotRateLimited.mockClear();
  });

  it("throws when the input is empty after trimming", async () => {
    await expect(run("   ", rawResult())).rejects.toThrow("input is required.");
    expect(messagesParse).not.toHaveBeenCalled();
  });

  it("throws when the input exceeds MAX_INPUT_LENGTH (200 chars)", async () => {
    await expect(run("a".repeat(201), rawResult())).rejects.toThrow("Keep the command under 200 characters.");
  });

  it("checks the AI rate limiter with the caller's source IP before calling Claude", async () => {
    await run("what's expiring soon?", rawResult({ mode: "answer" }));

    expect(assertAiNotRateLimited).toHaveBeenCalledWith("1.2.3.4");
  });

  it("propagates a rate-limit rejection without calling Claude", async () => {
    assertAiNotRateLimited.mockRejectedValueOnce(new Error("Too many requests"));

    await expect(run("add milk", rawResult())).rejects.toThrow("Too many requests");
    expect(messagesParse).not.toHaveBeenCalled();
  });

  it("throws a friendly error when Claude returns no parsed output", async () => {
    await expect(run("add milk", null)).rejects.toThrow(
      "Claude didn't return a valid response - try rephrasing."
    );
  });
});

describe("parseCommand - answer mode", () => {
  beforeEach(() => {
    messagesParse.mockReset();
  });

  it("returns the answer text and null answerItems when none given", async () => {
    const result = await run(
      "how much milk?",
      rawResult({ mode: "answer", answer: "You have 1 L of milk." })
    );

    expect(result.answer).toBe("You have 1 L of milk.");
    expect(result.answerItems).toBeNull();
    expect(result.actions).toBeNull();
    expect(result.recipes).toBeNull();
  });

  it("returns answerItems when the model provided a list", async () => {
    const result = await run(
      "what spices do I have?",
      rawResult({ mode: "answer", answer: "Here's what you have:", answerItems: ["Cumin", "Paprika"] })
    );

    expect(result.answerItems).toEqual(["Cumin", "Paprika"]);
  });

  it("passes through a valid price-check offer for a real inventory item", async () => {
    const result = await run(
      "how much does milk cost?",
      rawResult({
        mode: "answer",
        answer: "No price on file yet - want me to check?",
        offerPriceCheckItemId: "inv-1",
        offerPriceCheckList: "inventory",
      }),
      { inventory: [inventoryItem({ id: "inv-1" })] }
    );

    expect(result.offerPriceCheckItemId).toBe("inv-1");
    expect(result.offerPriceCheckList).toBe("inventory");
  });

  it("passes through a valid price-check offer for a real shopping list entry", async () => {
    const result = await run(
      "how much are eggs?",
      rawResult({
        mode: "answer",
        offerPriceCheckItemId: "sl-1",
        offerPriceCheckList: "shoppingList",
      }),
      { shoppingList: [shoppingListEntry({ id: "sl-1" })] }
    );

    expect(result.offerPriceCheckList).toBe("shoppingList");
  });

  it("nulls out the offer when the id isn't a real, current item (hallucination guard)", async () => {
    const result = await run(
      "how much does milk cost?",
      rawResult({
        mode: "answer",
        offerPriceCheckItemId: "does-not-exist",
        offerPriceCheckList: "inventory",
      }),
      { inventory: [inventoryItem({ id: "inv-1" })] }
    );

    expect(result.offerPriceCheckItemId).toBeNull();
    expect(result.offerPriceCheckList).toBeNull();
  });

  it("treats empty-string sentinels as no offer", async () => {
    const result = await run("hi", rawResult({ mode: "answer" }));

    expect(result.offerPriceCheckItemId).toBeNull();
    expect(result.offerPriceCheckList).toBeNull();
  });

  it("nulls out the offer when itemId is set but list is the empty-string sentinel", async () => {
    const result = await run(
      "how much does milk cost?",
      rawResult({ mode: "answer", offerPriceCheckItemId: "inv-1", offerPriceCheckList: "" }),
      { inventory: [inventoryItem({ id: "inv-1" })] }
    );

    expect(result.offerPriceCheckItemId).toBeNull();
  });
});

describe("parseCommand - actions mode", () => {
  beforeEach(() => {
    messagesParse.mockReset();
  });

  it("builds a RECORD_PURCHASE action with the right mutation name and args", async () => {
    const result = await run(
      "bought milk",
      rawResult({
        mode: "actions",
        actions: [rawAction({ estimatedPriceAud: 4.5 })],
      })
    );

    expect(result.actions).toHaveLength(1);

    const action = result.actions![0];
    expect(action.mutationName).toBe("recordPurchase");
    expect(action.estimatedPriceAud).toBe(4.5);

    const args = JSON.parse(action.argsJson);
    expect(args.input.name).toBe("Milk");
    expect(args.input.location).toBe("FRIDGE");
    expect(args.input.quantity).toBe(2);
  });

  it("drops a RECORD_PURCHASE missing required fields (name/location/quantity)", async () => {
    const result = await run(
      "bought something",
      rawResult({ mode: "actions", actions: [rawAction({ name: null })] })
    );

    expect(result.actions).toBeNull();
    expect(result.message).toBe("I couldn't turn that into an action - try rephrasing.");
  });

  it("uses the estimatedPriceAud sentinel (0 means no estimate -> null) for RECORD_PURCHASE", async () => {
    const result = await run(
      "bought milk",
      rawResult({ mode: "actions", actions: [rawAction({ estimatedPriceAud: 0 })] })
    );

    expect(result.actions![0].estimatedPriceAud).toBeNull();
  });

  it("always nulls estimatedPriceAud for action types other than RECORD_PURCHASE/ADD_TO_SHOPPING_LIST", async () => {
    const result = await run(
      "remove milk",
      rawResult({
        mode: "actions",
        actions: [
          rawAction({
            type: "REMOVE_INVENTORY_ITEM",
            itemId: "inv-1",
            estimatedPriceAud: 99,
          }),
        ],
      }),
      { inventory: [inventoryItem({ id: "inv-1" })] }
    );

    expect(result.actions![0].estimatedPriceAud).toBeNull();
  });

  it("sets flagsSet booleans to true in RECORD_PURCHASE args", async () => {
    const result = await run(
      "add salt as low priority and track its price",
      rawResult({
        mode: "actions",
        actions: [rawAction({ flagsSet: ["LOW_PRIORITY", "TRACK_PRICE"] })],
      })
    );

    const args = JSON.parse(result.actions![0].argsJson);
    expect(args.input.lowPriority).toBe(true);
    expect(args.input.trackPrice).toBe(true);
    expect(args.input.isStaple).toBeNull();
    expect(args.input.nearlyEmpty).toBeNull();
  });

  it("sets flagsClear booleans to false in RECORD_PURCHASE args", async () => {
    const result = await run(
      "add milk, not a staple",
      rawResult({ mode: "actions", actions: [rawAction({ flagsClear: ["STAPLE"] })] })
    );

    const args = JSON.parse(result.actions![0].argsJson);
    expect(args.input.isStaple).toBe(false);
  });

  it("builds an UPDATE_INVENTORY_ITEM action including only the fields actually provided", async () => {
    const result = await run(
      "milk is now 500ml",
      rawResult({
        mode: "actions",
        actions: [
          rawAction({
            type: "UPDATE_INVENTORY_ITEM",
            itemId: "inv-1",
            name: null,
            location: null,
            category: null,
            quantity: 500,
            unit: "mL",
            price: null,
            purchasedAt: null,
            expiresAt: null,
          }),
        ],
      }),
      { inventory: [inventoryItem({ id: "inv-1" })] }
    );

    const action = result.actions![0];
    expect(action.mutationName).toBe("updateInventoryItem");

    const args = JSON.parse(action.argsJson);
    expect(args.id).toBe("inv-1");
    expect(args.input).toEqual({ quantity: 500, unit: "mL" });
  });

  it("drops UPDATE_INVENTORY_ITEM missing itemId", async () => {
    const result = await run(
      "update it",
      rawResult({ mode: "actions", actions: [rawAction({ type: "UPDATE_INVENTORY_ITEM", itemId: null })] })
    );

    expect(result.actions).toBeNull();
  });

  it("builds a REMOVE_INVENTORY_ITEM action", async () => {
    const result = await run(
      "remove milk",
      rawResult({
        mode: "actions",
        actions: [rawAction({ type: "REMOVE_INVENTORY_ITEM", itemId: "inv-1" })],
      }),
      { inventory: [inventoryItem({ id: "inv-1" })] }
    );

    expect(result.actions![0].mutationName).toBe("removeInventoryItem");
    expect(JSON.parse(result.actions![0].argsJson)).toEqual({ id: "inv-1" });
  });

  it("builds an ADD_TO_SHOPPING_LIST action", async () => {
    const result = await run(
      "need to buy bread",
      rawResult({
        mode: "actions",
        actions: [
          rawAction({
            type: "ADD_TO_SHOPPING_LIST",
            name: "Bread",
            quantity: null,
            unit: null,
            note: "for sandwiches",
            category: "Bread",
          }),
        ],
      })
    );

    const action = result.actions![0];
    expect(action.mutationName).toBe("addToShoppingList");
    expect(JSON.parse(action.argsJson)).toEqual({
      name: "Bread",
      quantity: null,
      unit: null,
      note: "for sandwiches",
      category: "Bread",
    });
  });

  it("drops ADD_TO_SHOPPING_LIST missing a name", async () => {
    const result = await run(
      "add to shopping list",
      rawResult({ mode: "actions", actions: [rawAction({ type: "ADD_TO_SHOPPING_LIST", name: null })] })
    );

    expect(result.actions).toBeNull();
  });

  it("builds a REMOVE_FROM_SHOPPING_LIST action", async () => {
    const result = await run(
      "remove eggs from the list",
      rawResult({
        mode: "actions",
        actions: [rawAction({ type: "REMOVE_FROM_SHOPPING_LIST", itemId: "sl-1" })],
      }),
      { shoppingList: [shoppingListEntry({ id: "sl-1" })] }
    );

    expect(result.actions![0].mutationName).toBe("removeFromShoppingList");
    expect(JSON.parse(result.actions![0].argsJson)).toEqual({ id: "sl-1" });
  });

  it("drops actions referencing a hallucinated itemId not in the current lists", async () => {
    const result = await run(
      "remove milk and remove eggs",
      rawResult({
        mode: "actions",
        actions: [
          rawAction({ type: "REMOVE_INVENTORY_ITEM", itemId: "real-inv" }),
          rawAction({ type: "REMOVE_INVENTORY_ITEM", itemId: "fake-inv" }),
        ],
      }),
      { inventory: [inventoryItem({ id: "real-inv" })] }
    );

    expect(result.actions).toHaveLength(1);
    expect(JSON.parse(result.actions![0].argsJson)).toEqual({ id: "real-inv" });
    expect(result.message).toBe("Some of what you asked couldn't be matched to a real item and was skipped.");
  });

  it("reports a not-found message (not the skip message) when EVERY action is dropped due to a bad id", async () => {
    const result = await run(
      "remove ghost item",
      rawResult({
        mode: "actions",
        actions: [rawAction({ type: "REMOVE_INVENTORY_ITEM", itemId: "fake-inv" })],
      }),
      { inventory: [] }
    );

    expect(result.actions).toBeNull();
    expect(result.message).toBe(
      "Couldn't find one of the items you mentioned - it may have already been removed or renamed."
    );
  });

  it("does not require a valid itemId for action types that don't reference one (e.g. RECORD_PURCHASE)", async () => {
    const result = await run("bought milk", rawResult({ mode: "actions", actions: [rawAction()] }));

    expect(result.actions).toHaveLength(1);
  });

  it("ignores the model's own message field in actions mode when nothing was dropped (message is null)", async () => {
    // Unlike recipes/unclear mode, plain actions mode never reads
    // parsed.message - it's droppedCount-derived only (see toProposedAction/
    // buildActions call site in parseCommand).
    const result = await run(
      "bought milk and something vague",
      rawResult({
        mode: "actions",
        actions: [rawAction()],
        message: "Not sure what else you meant - could you clarify?",
      })
    );

    expect(result.message).toBeNull();
  });
});

describe("parseCommand - recipes mode", () => {
  beforeEach(() => {
    messagesParse.mockReset();
  });

  function rawRecipe(overrides: Record<string, unknown> = {}) {
    return {
      name: "Carbonara",
      description: "Classic Italian pasta",
      ingredients: [],
      baseServings: 2,
      caloriesPerServing: 600,
      proteinGPerServing: 25,
      carbsGPerServing: 60,
      fatGPerServing: 20,
      ...overrides,
    };
  }

  it("returns sanitized recipes with baseServings coerced to at least 1", async () => {
    const result = await run(
      "how do I make carbonara",
      rawResult({ mode: "recipes", recipes: [rawRecipe({ baseServings: 0 })] })
    );

    expect(result.recipes).toHaveLength(1);
    expect(result.recipes![0].baseServings).toBe(1);
  });

  it("keeps a positive baseServings as given", async () => {
    const result = await run(
      "recipe for 4",
      rawResult({ mode: "recipes", recipes: [rawRecipe({ baseServings: 4 })] })
    );

    expect(result.recipes![0].baseServings).toBe(4);
  });

  it("nulls an ingredient's itemId when haveInInventory is claimed but the id isn't real", async () => {
    const result = await run(
      "ingredients for carbonara",
      rawResult({
        mode: "recipes",
        recipes: [
          rawRecipe({
            ingredients: [
              {
                name: "Eggs",
                amount: "2",
                haveInInventory: true,
                itemId: "fake-id",
                quantity: 2,
                estimatedPriceAud: 1,
              },
            ],
          }),
        ],
      }),
      { inventory: [inventoryItem({ id: "real-id" })] }
    );

    const ingredient = result.recipes![0].ingredients[0];
    expect(ingredient.itemId).toBeNull();
    // haveInInventory itself is preserved even without a valid id - it can
    // legitimately anticipate a same-response action succeeding.
    expect(ingredient.haveInInventory).toBe(true);
  });

  it("keeps a valid itemId for an ingredient matched to real inventory", async () => {
    const result = await run(
      "ingredients for carbonara",
      rawResult({
        mode: "recipes",
        recipes: [
          rawRecipe({
            ingredients: [
              {
                name: "Eggs",
                amount: "2",
                haveInInventory: true,
                itemId: "real-id",
                quantity: 2,
                estimatedPriceAud: 1,
              },
            ],
          }),
        ],
      }),
      { inventory: [inventoryItem({ id: "real-id" })] }
    );

    expect(result.recipes![0].ingredients[0].itemId).toBe("real-id");
  });

  it("also returns actions riding along with recipes (e.g. 'I have cinnamon already')", async () => {
    const result = await run(
      "I have cinnamon already",
      rawResult({
        mode: "recipes",
        recipes: [rawRecipe()],
        actions: [rawAction({ name: "Cinnamon" })],
      })
    );

    expect(result.recipes).toHaveLength(1);
    expect(result.actions).toHaveLength(1);
  });

  it("falls back to a dropped-items message when actions were filtered but the model gave no message", async () => {
    const result = await run(
      "I have cinnamon already (bogus id)",
      rawResult({
        mode: "recipes",
        recipes: [rawRecipe()],
        actions: [rawAction({ type: "REMOVE_INVENTORY_ITEM", itemId: "fake" })],
        message: null,
      })
    );

    expect(result.message).toBe("Some of what you asked couldn't be matched to a real item and was skipped.");
  });
});

describe("parseCommand - unclear mode", () => {
  beforeEach(() => {
    messagesParse.mockReset();
  });

  it("returns the model's message when given", async () => {
    const result = await run("asdkjhasd", rawResult({ mode: "unclear", message: "Not sure what you mean." }));

    expect(result.message).toBe("Not sure what you mean.");
    expect(result.answer).toBeNull();
    expect(result.actions).toBeNull();
  });

  it("falls back to a default message when the model gave none", async () => {
    const result = await run("asdkjhasd", rawResult({ mode: "unclear", message: null }));

    expect(result.message).toBe("I couldn't understand that - try rephrasing.");
  });
});

describe("parseCommand - conversation history", () => {
  beforeEach(() => {
    messagesParse.mockReset();
  });

  it("forwards history messages (capped at the last 20) plus the new input to Claude", async () => {
    const history = Array.from({ length: 25 }, (_, i) => ({ role: "user", content: `msg ${i}` }));

    await run("latest message", rawResult({ mode: "answer" }), { history });

    const call = messagesParse.mock.calls[0][0];
    // 20 history messages + the new user turn.
    expect(call.messages).toHaveLength(21);
    expect(call.messages[0].content).toBe("msg 5");
    expect(call.messages[call.messages.length - 1].content).toBe("latest message");
  });

  it("coerces any non-assistant role to user", async () => {
    await run("hi", rawResult({ mode: "answer" }), {
      history: [{ role: "system", content: "weird role" }],
    });

    const call = messagesParse.mock.calls[0][0];
    expect(call.messages[0].role).toBe("user");
  });
});
