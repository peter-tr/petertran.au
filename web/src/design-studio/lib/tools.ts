import type { ElementType } from "./elements";

// Number-key shortcuts (Excalidraw-style: press 1/2/3/... to trigger a tool
// without reaching for the mouse). Shared between Toolbar.tsx (renders the
// badges) and EditorWorkspace.tsx (its keydown handler dispatches off this
// same key->tool mapping) so the two can't drift apart.
export const TOOLS: { type: ElementType; label: string; key: string }[] = [
  { type: "rectangle", label: "Rectangle", key: "1" },
  { type: "ellipse", label: "Ellipse", key: "2" },
  { type: "arrow", label: "Arrow", key: "3" },
  { type: "text", label: "Text", key: "4" },
];

export const EXPORT_SHORTCUT_KEY = "5";
