export interface CanvasFormat {
  id: string;
  label: string;
  width: number;
  height: number;
}

// Offered when starting a blank design - orientation-based rather than
// named by use case (the old "Poster"/"Presentation" pair were both
// landscape and only ~60px apart in height, so the two read as arbitrary
// near-duplicates rather than a real choice). A third "Custom" option
// (see Gallery.tsx's inline width/height form) covers anything neither of
// these two fits - the canvas can't be resized after creation, so that's a
// one-time size pick up front rather than a setting inside the editor.
export const CANVAS_FORMATS: CanvasFormat[] = [
  { id: "landscape", label: "Landscape", width: 1280, height: 720 },
  { id: "vertical", label: "Vertical", width: 850, height: 1100 },
];

export const DEFAULT_FORMAT = CANVAS_FORMATS[0];

export const CUSTOM_SIZE_MIN = 100;
export const CUSTOM_SIZE_MAX = 4000;

// Fixed taxonomy for "Save as template"'s category field - matches the
// starter templates' own categories (see api/src/design-studio/lib/templates.ts).
// A free-text field here let category be effectively "whatever the user last
// typed" (typos, casing drift, near-duplicates), which is what made the
// gallery's category filter feel arbitrary; a closed list keeps every
// template (seed or custom) filed under the same handful of buckets.
export const TEMPLATE_CATEGORIES = [
  "Poster",
  "Presentation",
  "Resume",
  "Social Media",
  "Business Card",
  "Flyer",
] as const;
