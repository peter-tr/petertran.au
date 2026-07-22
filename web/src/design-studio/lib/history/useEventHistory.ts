import { useCallback, useMemo, useState } from "react";
import type { DesignElement } from "../elements";
import { applyEvent, type HistoryEvent } from "./reducer";

// Current state is a fold over events[0, cursor) rather than a cloned
// snapshot per mutation - undo/redo just move the cursor, no state
// duplication. Dispatching after an undo truncates any events past the
// cursor, matching a normal editor undo stack: a new edit branching off an
// earlier point in history discards the abandoned "future".
export function useEventHistory(initialEvents: HistoryEvent[] = []) {
  const [events, setEvents] = useState<HistoryEvent[]>(initialEvents);
  const [cursor, setCursor] = useState(initialEvents.length);

  const elements = useMemo<DesignElement[]>(
    () => events.slice(0, cursor).reduce(applyEvent, [] as DesignElement[]),
    [events, cursor]
  );

  const dispatch = useCallback(
    (event: HistoryEvent) => {
      setEvents((prev) => [...prev.slice(0, cursor), event]);
      setCursor((prev) => prev + 1);
    },
    [cursor]
  );

  const undo = useCallback(() => setCursor((prev) => Math.max(0, prev - 1)), []);
  const redo = useCallback(() => setCursor((prev) => Math.min(events.length, prev + 1)), [events.length]);

  return {
    elements,
    events,
    cursor,
    dispatch,
    undo,
    redo,
    canUndo: cursor > 0,
    canRedo: cursor < events.length,
  };
}
