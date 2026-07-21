import type { DesignElement } from "../elements";

// Payloads deliberately vary per event type (add carries a whole element,
// reorder carries just an id ordering) - the same heterogeneity argument
// behind choosing Mongo over DynamoDB for persisting this log applies here
// too: a rigid shared event shape would force every event into a lossy
// common structure.
export type HistoryEvent =
  | { type: "add"; element: DesignElement }
  | { type: "update"; id: string; before: Partial<DesignElement>; after: Partial<DesignElement> }
  | { type: "remove"; element: DesignElement }
  | { type: "reorder"; order: string[] };

export function applyEvent(elements: DesignElement[], event: HistoryEvent): DesignElement[] {
  switch (event.type) {
    case "add":
      return [...elements, event.element];

    case "update":
      return elements.map((el) => (el.id === event.id ? ({ ...el, ...event.after } as DesignElement) : el));

    case "remove":
      return elements.filter((el) => el.id !== event.element.id);

    case "reorder": {
      const zIndexById = new Map(event.order.map((id, index) => [id, index]));
      return elements.map((el) => ({ ...el, zIndex: zIndexById.get(el.id) ?? el.zIndex }));
    }
  }
}
