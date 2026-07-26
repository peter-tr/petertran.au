import type { ElementType } from "../lib/elements";
import { TOOLS, EXPORT_SHORTCUT_KEY } from "../lib/tools";

interface ToolbarProps {
  onAdd: (type: ElementType) => void;
  onExport: () => void;
  exporting: boolean;
}

export default function Toolbar({ onAdd, onExport, exporting }: ToolbarProps) {
  return (
    <div className="design-studio-toolbar">
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
    </div>
  );
}
