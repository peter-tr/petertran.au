import type { ElementType } from "../lib/elements";
import { TOOLS, EXPORT_SHORTCUT_KEY } from "../lib/tools";

interface ToolbarProps {
  onAdd: (type: ElementType) => void;
  onExport: () => void;
  exporting: boolean;
  zoomPercent: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  // A vertical rail beside a portrait canvas, a horizontal strip below a
  // landscape one - see EditorWorkspace's isPortrait.
  vertical: boolean;
}

export default function Toolbar({
  onAdd,
  onExport,
  exporting,
  zoomPercent,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  vertical,
}: Readonly<ToolbarProps>) {
  return (
    <div className={"design-studio-toolbar" + (vertical ? " design-studio-toolbar--vertical" : "")}>
      {TOOLS.map((tool) => (
        <button
          key={tool.type}
          type="button"
          className="design-studio-tool-btn"
          onClick={() => onAdd(tool.type)}
          title={`${tool.label} (${tool.key})`}
        >
          {tool.label}
          <span className="design-studio-tool-shortcut">{tool.key}</span>
        </button>
      ))}
      <hr className="design-studio-toolbar-rule" />
      <button
        type="button"
        className="design-studio-tool-btn"
        onClick={onExport}
        disabled={exporting}
        title={`Export PNG (${EXPORT_SHORTCUT_KEY})`}
      >
        {exporting ? "Exporting…" : "Export PNG"}
        <span className="design-studio-tool-shortcut">{EXPORT_SHORTCUT_KEY}</span>
      </button>
      <hr className="design-studio-toolbar-rule" />
      {/* A real <fieldset> rather than a <div role="group"> - same grouping
          semantics, from the native element instead of an ARIA override. */}
      <fieldset
        className={"design-studio-zoom-controls" + (vertical ? " design-studio-zoom-controls--vertical" : "")}
        aria-label="Canvas zoom"
      >
        <button type="button" className="design-studio-zoom-btn" onClick={onZoomOut} title="Zoom out">
          −
        </button>
        <button
          type="button"
          className="design-studio-zoom-btn design-studio-zoom-readout"
          onClick={onZoomReset}
          title="Reset to fit"
        >
          {zoomPercent}%
        </button>
        <button type="button" className="design-studio-zoom-btn" onClick={onZoomIn} title="Zoom in">
          +
        </button>
      </fieldset>
    </div>
  );
}
