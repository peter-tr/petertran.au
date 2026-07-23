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

  it("keeps every event when dispatch is called multiple times in one synchronous batch", () => {
    // Mirrors EditorWorkspace's handleAcceptDraft, which loops over drafted
    // elements calling dispatch once per element inside a single event
    // handler - all of those calls land in the same React batch (one act()
    // here), unlike every other test in this file which flushes state
    // between dispatches via separate act() calls.
    const { result } = renderHook(() => useEventHistory());
    const first = createRectangle([], 100, 100);
    const second = createRectangle([first], 200, 200);
    const third = createRectangle([first, second], 300, 300);

    act(() => {
      result.current.dispatch({ type: "add", element: first });
      result.current.dispatch({ type: "add", element: second });
      result.current.dispatch({ type: "add", element: third });
    });

    expect(result.current.elements).toEqual([first, second, third]);
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
