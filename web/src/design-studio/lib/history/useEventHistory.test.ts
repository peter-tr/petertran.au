import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useEventHistory } from "./useEventHistory";
import { createRectangle } from "../elements";

describe("useEventHistory", () => {
  it("starts empty with nothing to undo or redo", () => {
    const { result } = renderHook(() => useEventHistory());

    expect(result.current.elements).toEqual([]);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("folds dispatched events into the current elements", () => {
    const { result } = renderHook(() => useEventHistory());
    const rect = createRectangle([], 100, 100);

    act(() => result.current.dispatch({ type: "add", element: rect }));

    expect(result.current.elements).toEqual([rect]);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it("undo moves the cursor back without dropping the event", () => {
    const { result } = renderHook(() => useEventHistory());
    const rect = createRectangle([], 100, 100);

    act(() => result.current.dispatch({ type: "add", element: rect }));
    act(() => result.current.undo());

    expect(result.current.elements).toEqual([]);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
  });

  it("redo replays the event again after an undo", () => {
    const { result } = renderHook(() => useEventHistory());
    const rect = createRectangle([], 100, 100);

    act(() => result.current.dispatch({ type: "add", element: rect }));
    act(() => result.current.undo());
    act(() => result.current.redo());

    expect(result.current.elements).toEqual([rect]);
    expect(result.current.canRedo).toBe(false);
  });

  it("dispatching after an undo truncates the abandoned future events", () => {
    const { result } = renderHook(() => useEventHistory());
    const rect = createRectangle([], 100, 100);
    const ellipse = createRectangle([rect], 200, 200);

    act(() => result.current.dispatch({ type: "add", element: rect }));
    act(() => result.current.undo());
    act(() => result.current.dispatch({ type: "add", element: ellipse }));

    expect(result.current.elements).toEqual([ellipse]);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.events).toEqual([{ type: "add", element: ellipse }]);
  });
});
