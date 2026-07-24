import { useCallback, useMemo, useState } from "react";
import type { DesignElement } from "../elements";
import { applyEvent, type HistoryEvent } from "./reducer";

interface HistoryState {
  events: HistoryEvent[];
  cursor: number;
}

// Current state is a fold over events[0, cursor) rather than a cloned
// snapshot per mutation - undo/redo just move the cursor, no state
// duplication. Dispatching after an undo truncates any events past the
// cursor, matching a normal editor undo stack: a new edit branching off an
// earlier point in history discards the abandoned "future".
//
// events and cursor are kept in one state atom (not two separate useState
// calls) deliberately - React applies queued functional updaters in order,
// each receiving the previous updater's result as `prev`, but only for the
// SAME state variable. A caller that dispatches multiple times within one
// synchronous batch (e.g. EditorWorkspace's handleAcceptDraft, looping over
// drafted elements) would otherwise have every dispatch after the first
// truncate using a stale `cursor` still closed over from before the batch
// started, silently discarding all but the last event. Bundling both into
// one state value means each updater's `prev.cursor` reflects every prior
// dispatch already queued in the same batch, not just the value at render
// time.
export function useEventHistory(initialEvents: HistoryEvent[] = []) {
  const [state, setState] = useState<HistoryState>({
    events: initialEvents,
    cursor: initialEvents.length,
  });

  const elements = useMemo<DesignElement[]>(
    () => state.events.slice(0, state.cursor).reduce(applyEvent, [] as DesignElement[]),
    [state.events, state.cursor]
  );

  const dispatch = useCallback((event: HistoryEvent) => {
    setState((prev) => ({
      events: [...prev.events.slice(0, prev.cursor), event],
      cursor: prev.cursor + 1,
    }));
  }, []);

  const undo = useCallback(() => setState((prev) => ({ ...prev, cursor: Math.max(0, prev.cursor - 1) })), []);
  const redo = useCallback(
    () => setState((prev) => ({ ...prev, cursor: Math.min(prev.events.length, prev.cursor + 1) })),
    []
  );

  return {
    elements,
    events: state.events,
    cursor: state.cursor,
    dispatch,
    undo,
    redo,
    canUndo: state.cursor > 0,
    canRedo: state.cursor < state.events.length,
  };
}
