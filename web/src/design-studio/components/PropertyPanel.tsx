import type { DesignElement } from "../lib/elements";

interface PropertyPanelProps {
  element: DesignElement | undefined;
  onChange: (element: DesignElement) => void;
}

const FONT_FAMILIES = ["IBM Plex Sans", "IBM Plex Mono", "Georgia", "Arial"];

export default function PropertyPanel({ element, onChange }: PropertyPanelProps) {
  if (!element) {
    return (
      <div className="design-studio-properties">
        <h2>Properties</h2>
        <p className="design-studio-empty">Select an element to edit its properties</p>
      </div>
    );
  }

  return (
    <div className="design-studio-properties">
      <h2>Properties</h2>
      <label className="design-studio-field">
        Fill
        <input
          type="color"
          value={element.fill}
          onChange={(e) => onChange({ ...element, fill: e.target.value })}
        />
      </label>
      <label className="design-studio-field">
        Stroke
        <input
          type="color"
          value={element.stroke || "#000000"}
          onChange={(e) => onChange({ ...element, stroke: e.target.value })}
        />
      </label>
      <label className="design-studio-field">
        Stroke width
        <input
          type="number"
          min={0}
          max={20}
          value={element.strokeWidth}
          onChange={(e) => onChange({ ...element, strokeWidth: Number(e.target.value) })}
        />
      </label>

      {element.type === "text" && (
        <>
          <label className="design-studio-field">
            Font
            <select
              value={element.fontFamily}
              onChange={(e) => onChange({ ...element, fontFamily: e.target.value })}
            >
              {FONT_FAMILIES.map((font) => (
                <option key={font} value={font}>
                  {font}
                </option>
              ))}
            </select>
          </label>
          <label className="design-studio-field">
            Size
            <input
              type="number"
              min={8}
              max={200}
              value={element.fontSize}
              onChange={(e) => onChange({ ...element, fontSize: Number(e.target.value) })}
            />
          </label>
          <label className="design-studio-field design-studio-field-inline">
            <input
              type="checkbox"
              checked={element.fontWeight >= 600}
              onChange={(e) => onChange({ ...element, fontWeight: e.target.checked ? 700 : 400 })}
            />
            Bold
          </label>
        </>
      )}
    </div>
  );
}
