import type { ElementType } from "../lib/elements";

interface ToolbarProps {
  onAdd: (type: ElementType) => void;
  onExport: () => void;
}

const TOOLS: { type: ElementType; label: string }[] = [
  { type: "rectangle", label: "Rectangle" },
  { type: "ellipse", label: "Ellipse" },
  { type: "text", label: "Text" },
];

export default function Toolbar({ onAdd, onExport }: ToolbarProps) {
  return (
    <div className="design-studio-toolbar">
      {TOOLS.map((tool) => (
        <button
          key={tool.type}
          type="button"
          className="design-studio-tool-btn"
          onClick={() => onAdd(tool.type)}
        >
          {tool.label}
        </button>
      ))}
      <hr className="design-studio-toolbar-rule" />
      <button type="button" className="design-studio-tool-btn" onClick={onExport}>
        Export PNG
      </button>
    </div>
  );
}
