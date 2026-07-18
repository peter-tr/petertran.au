import { createGraphQLClient } from "../shared/graphqlClient";
import { StorageLocation, PantryActionType } from "./api-schema-types.generated";
import type {
  AddInventoryItemInput as SchemaAddInventoryItemInput,
  UpdateInventoryItemInput as SchemaUpdateInventoryItemInput,
  UpdateShoppingListEntryInput as SchemaUpdateShoppingListEntryInput,
  PantrySettingsInput as SchemaPantrySettingsInput,
} from "./api-schema-types.generated";
import type {
  AiCallDebugInfoFieldsFragment,
  LastKnownPriceFieldsFragment,
  InventoryItemFieldsFragment,
  InventoryQuery,
  AddInventoryItemMutation,
  RecordPurchaseMutation,
  UpdateInventoryItemMutation,
  RemoveInventoryItemMutation,
  ShoppingListEntryFieldsFragment,
  ShoppingListQuery,
  RemoveFromShoppingListMutation,
  AddToShoppingListMutation,
  UpdateShoppingListEntryMutation,
  SettingsFieldsFragment,
  PantrySettingsQueryQuery,
  UpdateSettingsMutation,
  SyncPricesNowMutation,
  CheckPriceNowMutation,
  PriceSyncStatusQuery,
  ParseCommandQuery,
} from "./api.generated";

// Separate endpoint, separate service - the pantry API (api/src/pantry/) is
// its own Lambda/Function URL, deployed independently of the resume API this
// site otherwise runs on, even though its source lives in the same workspace.
export const PANTRY_ENDPOINT = import.meta.env.VITE_PANTRY_GRAPHQL_ENDPOINT as string | undefined;

export const runPantryQuery = createGraphQLClient(PANTRY_ENDPOINT, "VITE_PANTRY_GRAPHQL_ENDPOINT");

export { StorageLocation };

export type AiCallDebugInfo = AiCallDebugInfoFieldsFragment;

const AI_CALL_DEBUG_INFO_FIELDS = /* GraphQL */ `
  fragment AiCallDebugInfoFields on AiCallDebugInfo {
    costUsd
    durationMs
    searchesUsed
    fetchesUsed
  }
`;

export type LastKnownPrice = LastKnownPriceFieldsFragment;

export type InventoryItem = InventoryItemFieldsFragment;

// No standalone GraphQL fragment - purchases are only ever selected inline
// as part of InventoryItemFields below.
export type Purchase = InventoryItemFieldsFragment["purchases"][number];

export type AddInventoryItemInput = SchemaAddInventoryItemInput;

const LAST_KNOWN_PRICE_FIELDS = /* GraphQL */ `
  fragment LastKnownPriceFields on LastKnownPrice {
    colesPrice
    productUrl
    note
    checkedAt
    debugInfo {
      ...AiCallDebugInfoFields
    }
  }
  ${AI_CALL_DEBUG_INFO_FIELDS}
`;

const INVENTORY_ITEM_FIELDS = /* GraphQL */ `
  fragment InventoryItemFields on InventoryItem {
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
    trackPrice
    lastKnownPrice {
      ...LastKnownPriceFields
    }
    purchases {
      date
      price
      quantity
    }
    addedAt
    updatedAt
  }
  ${LAST_KNOWN_PRICE_FIELDS}
`;

export const INVENTORY_QUERY = /* GraphQL */ `
  query Inventory {
    inventory {
      ...InventoryItemFields
    }
  }
  ${INVENTORY_ITEM_FIELDS}
`;

export type InventoryQueryResult = InventoryQuery;

export const ADD_INVENTORY_ITEM_MUTATION = /* GraphQL */ `
  mutation AddInventoryItem($input: AddInventoryItemInput!) {
    addInventoryItem(input: $input) {
      ...InventoryItemFields
    }
  }
  ${INVENTORY_ITEM_FIELDS}
`;

export type AddInventoryItemResult = AddInventoryItemMutation;

// The merge-or-create decision (matching by normalized name within the same
// location) happens server-side now, so the client just always calls this
// for "add" flows instead of deciding locally whether to add or update.
export const RECORD_PURCHASE_MUTATION = /* GraphQL */ `
  mutation RecordPurchase($input: AddInventoryItemInput!) {
    recordPurchase(input: $input) {
      ...InventoryItemFields
    }
  }
  ${INVENTORY_ITEM_FIELDS}
`;

export type RecordPurchaseResult = RecordPurchaseMutation;

export type UpdateInventoryItemInput = SchemaUpdateInventoryItemInput;

export const UPDATE_INVENTORY_ITEM_MUTATION = /* GraphQL */ `
  mutation UpdateInventoryItem($id: ID!, $input: UpdateInventoryItemInput!) {
    updateInventoryItem(id: $id, input: $input) {
      ...InventoryItemFields
    }
  }
  ${INVENTORY_ITEM_FIELDS}
`;

export type UpdateInventoryItemResult = UpdateInventoryItemMutation;

export const REMOVE_INVENTORY_ITEM_MUTATION = /* GraphQL */ `
  mutation RemoveInventoryItem($id: ID!) {
    removeInventoryItem(id: $id)
  }
`;

export type RemoveInventoryItemResult = RemoveInventoryItemMutation;

export type ShoppingListEntry = ShoppingListEntryFieldsFragment;

// Shared across the query and both mutations below so adding a field means
// editing one list, not hunting down every place ShoppingListEntry is
// selected - the same class of drift that bit the inventory add form.
const SHOPPING_LIST_ENTRY_FIELDS = /* GraphQL */ `
  fragment ShoppingListEntryFields on ShoppingListEntry {
    id
    name
    quantity
    unit
    note
    isStaple
    category
    recipeTag
    urgent
    trackPrice
    lastKnownPrice {
      ...LastKnownPriceFields
    }
    addedAt
  }
  ${LAST_KNOWN_PRICE_FIELDS}
`;

export const SHOPPING_LIST_QUERY = /* GraphQL */ `
  query ShoppingList {
    shoppingList {
      ...ShoppingListEntryFields
    }
  }
  ${SHOPPING_LIST_ENTRY_FIELDS}
`;

export type ShoppingListQueryResult = ShoppingListQuery;

export const REMOVE_FROM_SHOPPING_LIST_MUTATION = /* GraphQL */ `
  mutation RemoveFromShoppingList($id: ID!) {
    removeFromShoppingList(id: $id)
  }
`;

export type RemoveFromShoppingListResult = RemoveFromShoppingListMutation;

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
      ...ShoppingListEntryFields
    }
  }
  ${SHOPPING_LIST_ENTRY_FIELDS}
`;

export type AddToShoppingListResult = AddToShoppingListMutation;

export type UpdateShoppingListEntryInput = SchemaUpdateShoppingListEntryInput;

export const UPDATE_SHOPPING_LIST_ENTRY_MUTATION = /* GraphQL */ `
  mutation UpdateShoppingListEntry($id: ID!, $input: UpdateShoppingListEntryInput!) {
    updateShoppingListEntry(id: $id, input: $input) {
      ...ShoppingListEntryFields
    }
  }
  ${SHOPPING_LIST_ENTRY_FIELDS}
`;

export type UpdateShoppingListEntryResult = UpdateShoppingListEntryMutation;

export type PantrySettings = SettingsFieldsFragment;

export type PantrySettingsInput = SchemaPantrySettingsInput;

const SETTINGS_FIELDS = /* GraphQL */ `
  fragment SettingsFields on PantrySettings {
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
    shoppingOptionsCollapsed
    shoppingSort
    shoppingSimple
    digestEnabled
    digestHour
    nerdModeInventory
    nerdModeShoppingList
    nerdModeCommandBar
  }
`;

export const SETTINGS_QUERY = /* GraphQL */ `
  query PantrySettingsQuery {
    settings {
      ...SettingsFields
    }
  }
  ${SETTINGS_FIELDS}
`;

export type SettingsQueryResult = PantrySettingsQueryQuery;

export const UPDATE_SETTINGS_MUTATION = /* GraphQL */ `
  mutation UpdateSettings($input: PantrySettingsInput!) {
    updateSettings(input: $input) {
      ...SettingsFields
    }
  }
  ${SETTINGS_FIELDS}
`;

export type UpdateSettingsResult = UpdateSettingsMutation;

export const SYNC_PRICES_NOW_MUTATION = /* GraphQL */ `
  mutation SyncPricesNow {
    syncPricesNow
  }
`;

export type SyncPricesNowResult = SyncPricesNowMutation;

export const CHECK_PRICE_NOW_MUTATION = /* GraphQL */ `
  mutation CheckPriceNow($id: ID!, $list: String!) {
    checkPriceNow(id: $id, list: $list)
  }
`;

export type CheckPriceNowResult = CheckPriceNowMutation;

export type PriceCheckError = PriceSyncStatusQuery["priceSyncStatus"]["errors"][number];

export type PriceSyncStatus = PriceSyncStatusQuery["priceSyncStatus"];

export const PRICE_SYNC_STATUS_QUERY = /* GraphQL */ `
  query PriceSyncStatus {
    priceSyncStatus {
      running
      startedAt
      finishedAt
      totalItems
      checkedItems
      errors {
        itemName
        message
        occurredAt
      }
    }
  }
`;

export type PriceSyncStatusResult = PriceSyncStatusQuery;

export { PantryActionType };

// No standalone GraphQL fragment - actions/recipes/ingredients below are only
// ever selected inline as part of ParseCommand's response.
export type ProposedAction = NonNullable<ParseCommandQuery["parseCommand"]["actions"]>[number];

export type RecipeSuggestion = NonNullable<ParseCommandQuery["parseCommand"]["recipes"]>[number];

export type RecipeIngredient = RecipeSuggestion["ingredients"][number];

export type ParsedCommand = ParseCommandQuery["parseCommand"];

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
      debugInfo {
        ...AiCallDebugInfoFields
      }
      offerPriceCheckItemId
      offerPriceCheckList
      actions {
        type
        summary
        mutationName
        argsJson
        estimatedPriceAud
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
  ${AI_CALL_DEBUG_INFO_FIELDS}
`;

export type ParseCommandResult = ParseCommandQuery;

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
