import { GraphQLRequestError } from "./graphql";

// Separate endpoint, separate service - the pantry API (api/src/pantry/) is
// its own Lambda/Function URL, deployed independently of the resume API this
// site otherwise runs on, even though its source lives in the same workspace.
export const PANTRY_ENDPOINT = import.meta.env.VITE_PANTRY_GRAPHQL_ENDPOINT as string | undefined;

export async function runPantryQuery<T = unknown>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  if (!PANTRY_ENDPOINT) {
    throw new GraphQLRequestError("VITE_PANTRY_GRAPHQL_ENDPOINT is not configured.");
  }

  const res = await fetch(PANTRY_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new GraphQLRequestError(`Request failed with status ${res.status}`);
  }

  const json = await res.json();

  if (json.errors?.length) {
    throw new GraphQLRequestError(json.errors.map((e: { message: string }) => e.message).join("; "));
  }

  return json.data as T;
}

export type StorageLocation = "FRIDGE" | "FREEZER" | "PANTRY";

export interface Purchase {
  date: string;
  price: number | null;
  quantity: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: string | null;
  location: StorageLocation;
  quantity: number;
  unit: string | null;
  price: number | null;
  purchasedAt: string | null;
  expiresAt: string | null;
  isStaple: boolean;
  purchases: Purchase[];
  addedAt: string;
  updatedAt: string;
}

export interface AddInventoryItemInput {
  name: string;
  category?: string | null;
  location: StorageLocation;
  quantity: number;
  unit?: string | null;
  price?: number | null;
  purchasedAt?: string | null;
  expiresAt?: string | null;
  isStaple?: boolean | null;
}

const INVENTORY_ITEM_FIELDS = /* GraphQL */ `
  id
  name
  category
  location
  quantity
  unit
  price
  purchasedAt
  expiresAt
  isStaple
  purchases {
    date
    price
    quantity
  }
  addedAt
  updatedAt
`;

export const INVENTORY_QUERY = /* GraphQL */ `
  query Inventory {
    inventory {
      ${INVENTORY_ITEM_FIELDS}
    }
  }
`;

export interface InventoryQueryResult {
  inventory: InventoryItem[];
}

export const ADD_INVENTORY_ITEM_MUTATION = /* GraphQL */ `
  mutation AddInventoryItem($input: AddInventoryItemInput!) {
    addInventoryItem(input: $input) {
      ${INVENTORY_ITEM_FIELDS}
    }
  }
`;

export interface AddInventoryItemResult {
  addInventoryItem: InventoryItem;
}

// The merge-or-create decision (matching by normalized name within the same
// location) happens server-side now, so the client just always calls this
// for "add" flows instead of deciding locally whether to add or update.
export const RECORD_PURCHASE_MUTATION = /* GraphQL */ `
  mutation RecordPurchase($input: AddInventoryItemInput!) {
    recordPurchase(input: $input) {
      ${INVENTORY_ITEM_FIELDS}
    }
  }
`;

export interface RecordPurchaseResult {
  recordPurchase: InventoryItem;
}

export const UPDATE_INVENTORY_ITEM_MUTATION = /* GraphQL */ `
  mutation UpdateInventoryItem($id: ID!, $input: UpdateInventoryItemInput!) {
    updateInventoryItem(id: $id, input: $input) {
      ${INVENTORY_ITEM_FIELDS}
    }
  }
`;

export interface UpdateInventoryItemResult {
  updateInventoryItem: InventoryItem;
}

export const REMOVE_INVENTORY_ITEM_MUTATION = /* GraphQL */ `
  mutation RemoveInventoryItem($id: ID!) {
    removeInventoryItem(id: $id)
  }
`;

export interface RemoveInventoryItemResult {
  removeInventoryItem: boolean;
}

export interface ShoppingListEntry {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  note: string | null;
  addedAt: string;
}

export const SHOPPING_LIST_QUERY = /* GraphQL */ `
  query ShoppingList {
    shoppingList {
      id
      name
      quantity
      unit
      note
      addedAt
    }
  }
`;

export interface ShoppingListQueryResult {
  shoppingList: ShoppingListEntry[];
}

export const REMOVE_FROM_SHOPPING_LIST_MUTATION = /* GraphQL */ `
  mutation RemoveFromShoppingList($id: ID!) {
    removeFromShoppingList(id: $id)
  }
`;

export interface RemoveFromShoppingListResult {
  removeFromShoppingList: boolean;
}

export const ADD_TO_SHOPPING_LIST_MUTATION = /* GraphQL */ `
  mutation AddToShoppingList($name: String!, $quantity: Float, $unit: String, $note: String) {
    addToShoppingList(name: $name, quantity: $quantity, unit: $unit, note: $note) {
      id
      name
      quantity
      unit
      note
      addedAt
    }
  }
`;

export interface AddToShoppingListResult {
  addToShoppingList: ShoppingListEntry;
}

export interface PantrySettings {
  view: string;
  sort: string;
  simple: boolean;
  optionsCollapsed: boolean;
  collapsedGroups: string[];
  commonItems: string[];
  shoppingListCollapsed: boolean;
}

export type PantrySettingsInput = Partial<PantrySettings>;

const SETTINGS_FIELDS = /* GraphQL */ `
  view
  sort
  simple
  optionsCollapsed
  collapsedGroups
  commonItems
  shoppingListCollapsed
`;

export const SETTINGS_QUERY = /* GraphQL */ `
  query PantrySettingsQuery {
    settings {
      ${SETTINGS_FIELDS}
    }
  }
`;

export interface SettingsQueryResult {
  settings: PantrySettings;
}

export const UPDATE_SETTINGS_MUTATION = /* GraphQL */ `
  mutation UpdateSettings($input: PantrySettingsInput!) {
    updateSettings(input: $input) {
      ${SETTINGS_FIELDS}
    }
  }
`;

export interface UpdateSettingsResult {
  updateSettings: PantrySettings;
}

export type PantryActionType =
  | "RECORD_PURCHASE"
  | "UPDATE_INVENTORY_ITEM"
  | "REMOVE_INVENTORY_ITEM"
  | "ADD_TO_SHOPPING_LIST"
  | "REMOVE_FROM_SHOPPING_LIST";

export interface ProposedAction {
  type: PantryActionType;
  summary: string;
  mutationName: string;
  argsJson: string;
}

export interface RecipeIngredient {
  name: string;
  amount: string | null;
  haveInInventory: boolean;
  itemId: string | null;
}

export interface RecipeSuggestion {
  name: string;
  description: string | null;
  ingredients: RecipeIngredient[];
}

export interface ParsedCommand {
  answer: string | null;
  actions: ProposedAction[] | null;
  recipes: RecipeSuggestion[] | null;
  message: string | null;
}

// Mirrors Claude's own {role, content} chat message shape - see
// api/src/pantry/lib/anthropic/parse-command.ts.
export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export const PARSE_COMMAND_QUERY = /* GraphQL */ `
  query ParseCommand($input: String!, $history: [ConversationMessage!]) {
    parseCommand(input: $input, history: $history) {
      answer
      message
      actions {
        type
        summary
        mutationName
        argsJson
      }
      recipes {
        name
        description
        ingredients {
          name
          amount
          haveInInventory
          itemId
        }
      }
    }
  }
`;

export interface ParseCommandResult {
  parseCommand: ParsedCommand;
}

// Confirming a proposed action just calls the same mutation the rest of the
// UI already uses - parseCommand never executes anything itself, it only
// names which of these to call and with what arguments (argsJson).
export const PANTRY_ACTION_MUTATIONS: Record<string, string> = {
  recordPurchase: RECORD_PURCHASE_MUTATION,
  updateInventoryItem: UPDATE_INVENTORY_ITEM_MUTATION,
  removeInventoryItem: REMOVE_INVENTORY_ITEM_MUTATION,
  addToShoppingList: ADD_TO_SHOPPING_LIST_MUTATION,
  removeFromShoppingList: REMOVE_FROM_SHOPPING_LIST_MUTATION,
};
