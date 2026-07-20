import { describe, expect, it } from "vitest";
import { INVENTORY_FLAGS, type InventoryFlagKey, type InventoryFlags } from "./inventoryFlags";

describe("INVENTORY_FLAGS", () => {
  it("defines exactly the four known flag keys, in a stable order", () => {
    expect(INVENTORY_FLAGS.map((f) => f.key)).toEqual([
      "isStaple",
      "lowPriority",
      "nearlyEmpty",
      "trackPrice",
    ]);
  });

  it("gives every flag a non-empty icon and label", () => {
    for (const flag of INVENTORY_FLAGS) {
      expect(flag.icon.length).toBeGreaterThan(0);
      expect(flag.label.length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate keys", () => {
    const keys = INVENTORY_FLAGS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // Both PantryAddItemSection and PantryEditItemModal build their checkbox
  // state as InventoryFlags keyed by INVENTORY_FLAGS - if this list ever grew
  // a key that's not a valid InventoryFlagKey (or vice versa), that's exactly
  // the class of drift the shared list exists to prevent.
  it("keeps every InventoryFlagKey representable in an InventoryFlags record", () => {
    const flags: InventoryFlags = {
      isStaple: false,
      lowPriority: false,
      nearlyEmpty: false,
      trackPrice: false,
    };
    for (const { key } of INVENTORY_FLAGS) {
      const typedKey: InventoryFlagKey = key;
      expect(typeof flags[typedKey]).toBe("boolean");
    }
  });
});
