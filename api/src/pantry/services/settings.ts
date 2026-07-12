import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME, PK } from "../lib/aws/ddb";

const SETTINGS_SK = "SETTINGS";

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
  shoppingOptionsCollapsed: boolean;
  shoppingSort: string;
  shoppingSimple: boolean;
  digestEnabled: boolean;
  digestHour: number;
  // Shows extra debug info (AI call cost, duration, search/fetch counts) on
  // the pantry page - inventory rows and the shopping list (+ command bar)
  // read their own flag to decide whether to render it, nothing
  // server-side depends on either. Split in two since shopping list is the
  // one actually used day-to-day; inventory is the noisier, bigger list.
  nerdModeInventory: boolean;
  nerdModeShoppingList: boolean;
}

export interface PantrySettingsInput {
  view?: string;
  sort?: string;
  simple?: boolean;
  optionsCollapsed?: boolean;
  collapsedGroups?: string[];
  commonItems?: string[];
  shoppingListCollapsed?: boolean;
  showLowPriority?: boolean;
  categoryFilter?: string | null;
  categories?: string[];
  addItemDetailsShown?: boolean;
  addItemCollapsed?: boolean;
  commonItemsCollapsed?: boolean;
  shoppingCategoryFilter?: string | null;
  shoppingRecipeFilter?: string | null;
  shoppingUrgentOnly?: boolean;
  shoppingOptionsCollapsed?: boolean;
  shoppingSort?: string;
  shoppingSimple?: boolean;
  digestEnabled?: boolean;
  digestHour?: number;
  nerdModeInventory?: boolean;
  nerdModeShoppingList?: boolean;
}

// Same starting list as the client used to seed localStorage with, so the
// very first request (before anyone has ever saved settings) behaves the
// same as before this was moved server-side.
const DEFAULT_SETTINGS: PantrySettings = {
  view: "location",
  sort: "recent",
  simple: false,
  optionsCollapsed: false,
  collapsedGroups: [],
  shoppingListCollapsed: false,
  showLowPriority: false,
  categoryFilter: null,
  addItemDetailsShown: false,
  addItemCollapsed: false,
  commonItemsCollapsed: false,
  shoppingCategoryFilter: null,
  shoppingRecipeFilter: null,
  shoppingUrgentOnly: false,
  shoppingOptionsCollapsed: false,
  shoppingSort: "recent",
  shoppingSimple: false,
  // Matches the digest's original fixed 4pm-daily behavior before this
  // became configurable, so existing rows behave identically once they
  // pick up this default via the getSettings() backfill merge below.
  digestEnabled: true,
  digestHour: 16,
  nerdModeInventory: false,
  nerdModeShoppingList: false,
  commonItems: [
    "Milk",
    "Eggs",
    "Bread",
    "Butter",
    "Cheese",
    "Chicken breast",
    "Rice",
    "Pasta",
    "Onions",
    "Tomatoes",
    "Bananas",
    "Apples",
    "Yoghurt",
    "Coffee",
  ],
  categories: [
    "Dairy",
    "Produce",
    "Meat",
    "Seafood",
    "Grains",
    "Spices",
    "Condiments",
    "Frozen",
    "Beverages",
    "Snacks",
    "Baking",
    "Canned Goods",
    "Bread",
    "Household",
  ],
};

// Merges with DEFAULT_SETTINGS rather than only falling back when nothing's
// stored at all - a settings row saved before a new field (like `sort`) was
// added would otherwise come back missing it, tripping the schema's
// non-null check instead of just quietly defaulting.
export async function getSettings(): Promise<PantrySettings> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: PK, sk: SETTINGS_SK } }));
  return { ...DEFAULT_SETTINGS, ...(res.Item?.data as Partial<PantrySettings> | undefined) };
}

export async function putSettings(settings: PantrySettings): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { pk: PK, sk: SETTINGS_SK, type: "SETTINGS", data: settings },
    })
  );
}
