import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useStaggerHomeFetches } from "./useStaggerHomeFetches";

const STORAGE_KEY = "portfolio:staggerHomeFetches";

describe("useStaggerHomeFetches", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to on when nothing is stored", () => {
    const { result } = renderHook(() => useStaggerHomeFetches());

    expect(result.current.staggerHomeFetches).toBe(true);
  });

  it("reads a previously stored 'false' value", () => {
    localStorage.setItem(STORAGE_KEY, "false");

    const { result } = renderHook(() => useStaggerHomeFetches());

    expect(result.current.staggerHomeFetches).toBe(false);
  });

  it("setStaggerHomeFetches persists to localStorage and updates state", () => {
    const { result } = renderHook(() => useStaggerHomeFetches());

    act(() => result.current.setStaggerHomeFetches(false));

    expect(result.current.staggerHomeFetches).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("false");
  });

  it("reacts to a 'storage' event from another tab", () => {
    const { result } = renderHook(() => useStaggerHomeFetches());

    localStorage.setItem(STORAGE_KEY, "false");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    });

    expect(result.current.staggerHomeFetches).toBe(false);
  });

  it("ignores storage events for unrelated keys", () => {
    const { result } = renderHook(() => useStaggerHomeFetches());

    localStorage.setItem("some:other:key", "false");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "some:other:key" }));
    });

    expect(result.current.staggerHomeFetches).toBe(true);
  });

  it("falls back to true if localStorage access throws", () => {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    const { result } = renderHook(() => useStaggerHomeFetches());

    expect(result.current.staggerHomeFetches).toBe(true);
    getItemSpy.mockRestore();
  });
});
