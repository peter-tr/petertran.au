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
  if (element.type === "text") return element.text.slice(0, 20) || "Text";
  return element.type === "rectangle" ? "Rectangle" : "Ellipse";
}

export default function LayersPanel({
  elements,
  selectedId,
  onSelect,
  onReorder,
  onDuplicate,
  onDelete,
}: LayersPanelProps) {
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
            onClick={() => onSelect(element.id)}
          >
            <span className="design-studio-layer-label">{elementLabel(element)}</span>
            <div className="design-studio-layer-actions">
              <button
                type="button"
                aria-label="Move up"
                disabled={index === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  move(element.id, -1);
                }}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label="Move down"
                disabled={index === topFirst.length - 1}
                onClick={(e) => {
                  e.stopPropagation();
                  move(element.id, 1);
                }}
              >
                ↓
              </button>
              <button
                type="button"
                aria-label="Duplicate"
                onClick={(e) => {
                  e.stopPropagation();
                  onDuplicate(element.id);
                }}
              >
                ⧉
              </button>
              <button
                type="button"
                aria-label="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(element.id);
                }}
              >
                ✕
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
