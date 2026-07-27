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

// Turns a design's name into a safe download filename: strips characters
// that are invalid (or awkward to deal with) in a downloaded file's name
// across OSes, and falls back to "design" when the name is empty/whitespace
// (e.g. a brand-new design the user hasn't titled yet).
export function toExportFileName(name: string): string {
  const sanitized = name.trim().replace(/[/\\?%*:|"<>]/g, "-");

  return `${sanitized || "design"}.png`;
}
