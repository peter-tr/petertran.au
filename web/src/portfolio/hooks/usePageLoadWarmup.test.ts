import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePageLoadWarmup } from "./usePageLoadWarmup";

const STORAGE_KEY = "portfolio:pageLoadWarmup";

describe("usePageLoadWarmup", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to on when nothing is stored", () => {
    const { result } = renderHook(() => usePageLoadWarmup());

    expect(result.current.pageLoadWarmup).toBe(true);
  });

  it("reads a previously stored 'false' value", () => {
    localStorage.setItem(STORAGE_KEY, "false");

    const { result } = renderHook(() => usePageLoadWarmup());

    expect(result.current.pageLoadWarmup).toBe(false);
  });

  it("setPageLoadWarmup persists to localStorage and updates state", () => {
    const { result } = renderHook(() => usePageLoadWarmup());

    act(() => result.current.setPageLoadWarmup(false));

    expect(result.current.pageLoadWarmup).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("false");
  });

  it("reacts to a 'storage' event from another tab", () => {
    const { result } = renderHook(() => usePageLoadWarmup());

    localStorage.setItem(STORAGE_KEY, "false");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    });

    expect(result.current.pageLoadWarmup).toBe(false);
  });

  it("ignores storage events for unrelated keys", () => {
    const { result } = renderHook(() => usePageLoadWarmup());

    localStorage.setItem("some:other:key", "false");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "some:other:key" }));
    });

    expect(result.current.pageLoadWarmup).toBe(true);
  });

  it("falls back to true if localStorage access throws", () => {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    const { result } = renderHook(() => usePageLoadWarmup());

    expect(result.current.pageLoadWarmup).toBe(true);
    getItemSpy.mockRestore();
  });
});
