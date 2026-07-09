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
  addedAt: string;
}

export const SHOPPING_LIST_QUERY = /* GraphQL */ `
  query ShoppingList {
    shoppingList {
      id
      name
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
  mutation AddToShoppingList($name: String!) {
    addToShoppingList(name: $name) {
      id
      name
      addedAt
    }
  }
`;

export interface AddToShoppingListResult {
  addToShoppingList: ShoppingListEntry;
}

export interface PantrySettings {
  view: string;
  simple: boolean;
  optionsCollapsed: boolean;
  collapsedGroups: string[];
  commonItems: string[];
}

export type PantrySettingsInput = Partial<PantrySettings>;

const SETTINGS_FIELDS = /* GraphQL */ `
  view
  simple
  optionsCollapsed
  collapsedGroups
  commonItems
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
