export interface CanvasFormat {
  id: string;
  label: string;
  width: number;
  height: number;
}

// Offered when starting a blank design - matches how templates each carry
// their own width/height rather than everything being forced onto one
// fixed canvas size.
export const CANVAS_FORMATS: CanvasFormat[] = [
  { id: "poster", label: "Poster", width: 900, height: 600 },
  { id: "presentation", label: "Presentation", width: 1280, height: 720 },
  { id: "resume", label: "Resume", width: 850, height: 1100 },
];

export const DEFAULT_FORMAT = CANVAS_FORMATS[0];
