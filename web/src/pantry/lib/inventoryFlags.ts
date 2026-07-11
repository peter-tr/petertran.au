export type InventoryFlagKey = "isStaple" | "lowPriority" | "nearlyEmpty" | "trackPrice";

export type InventoryFlags = Record<InventoryFlagKey, boolean>;

interface InventoryFlagDef {
  key: InventoryFlagKey;
  icon: string;
  label: string;
}

// Single source of truth for InventoryItem's boolean flags - every form
// that edits them (PantryAddItemSection, PantryEditItemModal) renders from
// this list instead of hand-rolling its own checkboxes. A new flag gets
// added here once; both forms pick it up automatically. This exists
// because lowPriority/nearlyEmpty were added to the edit modal but never
// wired into the add form - the same class of gap can't happen again once
// both forms share this list instead of each hand-rolling its own.
export const INVENTORY_FLAGS: InventoryFlagDef[] = [
  { key: "isStaple", icon: "★", label: "Staple - always keep stocked" },
  { key: "lowPriority", icon: "↓", label: "Low priority - hide from main list" },
  { key: "nearlyEmpty", icon: "!", label: "Nearly empty" },
  {
    key: "trackPrice",
    icon: "$",
    label: "Track price - check Coles/Woolworths daily and show the last known price",
  },
];
