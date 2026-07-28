import type { DesignElement } from "../lib/elements";

interface LayersPanelProps {
  elements: DesignElement[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReorder: (order: string[]) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

function elementLabel(element: DesignElement): string {
  switch (element.type) {
    case "text":
      return element.text.slice(0, 20) || "Text";
    case "rectangle":
      return "Rectangle";
    case "ellipse":
      return "Ellipse";
    case "arrow":
      return "Arrow";
  }
}

export default function LayersPanel({
  elements,
  selectedId,
  onSelect,
  onReorder,
  onDuplicate,
  onDelete,
}: Readonly<LayersPanelProps>) {
  // Top of the list = topmost layer (highest zIndex) - the conventional
  // layers-panel order, which is the reverse of raw zIndex order.
  const topFirst = [...elements].sort((a, b) => b.zIndex - a.zIndex);

  function move(id: string, direction: -1 | 1) {
    const index = topFirst.findIndex((el) => el.id === id);
    const swapIndex = index + direction;
    if (index === -1 || swapIndex < 0 || swapIndex >= topFirst.length) return;

    const order = topFirst.map((el) => el.id);
    [order[index], order[swapIndex]] = [order[swapIndex], order[index]];
    // order is top-first here; onReorder expects bottom-first (ascending
    // zIndex), so reverse before handing it off.
    onReorder([...order].reverse());
  }

  return (
    <div className="design-studio-layers">
      <h2>Layers</h2>
      {topFirst.length === 0 && <p className="design-studio-empty">No elements yet</p>}
      <ul>
        {topFirst.map((element, index) => (
          <li
            key={element.id}
            className={
              element.id === selectedId ? "design-studio-layer-row selected" : "design-studio-layer-row"
            }
          >
            {/* A real button rather than a click handler on the <li>, so
                selecting a layer is keyboard-reachable. It's a sibling of the
                per-layer actions below, so those no longer need to stop
                propagation to avoid also selecting the row. */}
            <button
              type="button"
              className="design-studio-layer-select"
              aria-pressed={element.id === selectedId}
              onClick={() => onSelect(element.id)}
            >
              <span className="design-studio-layer-label">{elementLabel(element)}</span>
            </button>
            <div className="design-studio-layer-actions">
              <button
                type="button"
                aria-label="Move up"
                disabled={index === 0}
                onClick={() => move(element.id, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label="Move down"
                disabled={index === topFirst.length - 1}
                onClick={() => move(element.id, 1)}
              >
                ↓
              </button>
              <button type="button" aria-label="Duplicate" onClick={() => onDuplicate(element.id)}>
                ⧉
              </button>
              <button type="button" aria-label="Delete" onClick={() => onDelete(element.id)}>
                ✕
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
