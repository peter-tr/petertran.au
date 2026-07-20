import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useShowAlsoBuilt } from "./useShowAlsoBuilt";

const STORAGE_KEY = "portfolio:showAlsoBuilt";

describe("useShowAlsoBuilt", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to visible when nothing is stored", () => {
    const { result } = renderHook(() => useShowAlsoBuilt());

    expect(result.current.showAlsoBuilt).toBe(true);
  });

  it("reads a previously stored 'false' value", () => {
    localStorage.setItem(STORAGE_KEY, "false");

    const { result } = renderHook(() => useShowAlsoBuilt());

    expect(result.current.showAlsoBuilt).toBe(false);
  });

  it("setShowAlsoBuilt persists to localStorage and updates state", () => {
    const { result } = renderHook(() => useShowAlsoBuilt());

    act(() => result.current.setShowAlsoBuilt(false));

    expect(result.current.showAlsoBuilt).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("false");
  });

  it("reacts to a 'storage' event from another tab/page", () => {
    const { result } = renderHook(() => useShowAlsoBuilt());

    localStorage.setItem(STORAGE_KEY, "false");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    });

    expect(result.current.showAlsoBuilt).toBe(false);
  });

  it("ignores storage events for unrelated keys", () => {
    const { result } = renderHook(() => useShowAlsoBuilt());

    localStorage.setItem("some:other:key", "false");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "some:other:key" }));
    });

    expect(result.current.showAlsoBuilt).toBe(true);
  });

  it("falls back to true if localStorage access throws", () => {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    const { result } = renderHook(() => useShowAlsoBuilt());

    expect(result.current.showAlsoBuilt).toBe(true);
    getItemSpy.mockRestore();
  });
});
