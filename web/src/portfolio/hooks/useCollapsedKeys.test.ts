import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCollapsedKeys } from "./useCollapsedKeys";

describe("useCollapsedKeys", () => {
  it("starts with nothing collapsed", () => {
    const { result } = renderHook(() => useCollapsedKeys());

    expect(result.current.isCollapsed("a")).toBe(false);
  });

  it("toggle collapses a key that was not collapsed", () => {
    const { result } = renderHook(() => useCollapsedKeys());

    act(() => result.current.toggle("a"));

    expect(result.current.isCollapsed("a")).toBe(true);
  });

  it("toggle expands a key that was collapsed", () => {
    const { result } = renderHook(() => useCollapsedKeys());

    act(() => result.current.toggle("a"));
    act(() => result.current.toggle("a"));

    expect(result.current.isCollapsed("a")).toBe(false);
  });

  it("tracks multiple keys independently", () => {
    const { result } = renderHook(() => useCollapsedKeys());

    act(() => result.current.toggle("a"));

    expect(result.current.isCollapsed("a")).toBe(true);
    expect(result.current.isCollapsed("b")).toBe(false);
  });
});
