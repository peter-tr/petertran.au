import { createGraphQLClient } from "../shared/graphqlClient";

// Separate endpoint, separate service - the pantry API (api/src/pantry/) is
// its own Lambda/Function URL, deployed independently of the resume API this
// site otherwise runs on, even though its source lives in the same workspace.
export const PANTRY_ENDPOINT = import.meta.env.VITE_PANTRY_GRAPHQL_ENDPOINT as string | undefined;

export const runPantryQuery = createGraphQLClient(PANTRY_ENDPOINT, "VITE_PANTRY_GRAPHQL_ENDPOINT");

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
  lowPriority: boolean;
  nearlyEmpty: boolean;
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
  lowPriority?: boolean | null;
  nearlyEmpty?: boolean | null;
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
  lowPriority
  nearlyEmpty
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
  isStaple: boolean;
  category: string | null;
  recipeTag: string | null;
  urgent: boolean;
  addedAt: string;
}

// Shared across the query and both mutations below so adding a field means
// editing one list, not hunting down every place ShoppingListEntry is
// selected - the same class of drift that bit the inventory add form.
const SHOPPING_LIST_ENTRY_FIELDS = /* GraphQL */ `
  id
  name
  quantity
  unit
  note
  isStaple
  category
  recipeTag
  urgent
  addedAt
`;

export const SHOPPING_LIST_QUERY = /* GraphQL */ `
  query ShoppingList {
    shoppingList {
      ${SHOPPING_LIST_ENTRY_FIELDS}
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
  mutation AddToShoppingList(
    $name: String!
    $quantity: Float
    $unit: String
    $note: String
    $isStaple: Boolean
    $category: String
    $recipeTag: String
    $urgent: Boolean
  ) {
    addToShoppingList(
      name: $name
      quantity: $quantity
      unit: $unit
      note: $note
      isStaple: $isStaple
      category: $category
      recipeTag: $recipeTag
      urgent: $urgent
    ) {
      ${SHOPPING_LIST_ENTRY_FIELDS}
    }
  }
`;

export interface AddToShoppingListResult {
  addToShoppingList: ShoppingListEntry;
}

export interface UpdateShoppingListEntryInput {
  name?: string;
  quantity?: number | null;
  unit?: string | null;
  note?: string | null;
  isStaple?: boolean;
  category?: string | null;
  recipeTag?: string | null;
  urgent?: boolean;
}

export const UPDATE_SHOPPING_LIST_ENTRY_MUTATION = /* GraphQL */ `
  mutation UpdateShoppingListEntry($id: ID!, $input: UpdateShoppingListEntryInput!) {
    updateShoppingListEntry(id: $id, input: $input) {
      ${SHOPPING_LIST_ENTRY_FIELDS}
    }
  }
`;

export interface UpdateShoppingListEntryResult {
  updateShoppingListEntry: ShoppingListEntry;
}

export interface PantrySettings {
  view: string;
  sort: string;
  simple: boolean;
  optionsCollapsed: boolean;
  collapsedGroups: string[];
  commonItems: string[];
  shoppingListCollapsed: boolean;
  showLowPriority: boolean;
  categoryFilter: string | null;
  categories: string[];
  addItemDetailsShown: boolean;
  addItemCollapsed: boolean;
  commonItemsCollapsed: boolean;
  shoppingCategoryFilter: string | null;
  shoppingRecipeFilter: string | null;
  shoppingUrgentOnly: boolean;
  digestEnabled: boolean;
  digestHour: number;
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
  showLowPriority
  categoryFilter
  categories
  addItemDetailsShown
  addItemCollapsed
  commonItemsCollapsed
  shoppingCategoryFilter
  shoppingRecipeFilter
  shoppingUrgentOnly
  digestEnabled
  digestHour
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
  // Leading numeric amount when cleanly scalable, 0 otherwise (a range,
  // "to taste", etc.) - see recipeScaling.ts.
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

export interface ParsedCommand {
  answer: string | null;
  answerItems: string[] | null;
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
      answerItems
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
        baseServings
        caloriesPerServing
        proteinGPerServing
        carbsGPerServing
        fatGPerServing
        ingredients {
          name
          amount
          haveInInventory
          itemId
          quantity
          estimatedPriceAud
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
