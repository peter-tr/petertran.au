export type ElementType = "rectangle" | "ellipse" | "text";

interface BaseElement {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export interface RectangleElement extends BaseElement {
  type: "rectangle";
}

export interface EllipseElement extends BaseElement {
  type: "ellipse";
}

export interface TextElement extends BaseElement {
  type: "text";
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
}

export type DesignElement = RectangleElement | EllipseElement | TextElement;

const DEFAULT_FILL = "#63c7be";
const DEFAULT_STROKE = "#0b0e14";

function nextZIndex(elements: DesignElement[]): number {
  return elements.length === 0 ? 0 : Math.max(...elements.map((el) => el.zIndex)) + 1;
}

// x/y are the drop position (e.g. canvas center) - callers place each new
// element there rather than always at a fixed origin, so successive adds
// don't stack exactly on top of each other unreadably.
export function createRectangle(elements: DesignElement[], x: number, y: number): RectangleElement {
  return {
    id: crypto.randomUUID(),
    type: "rectangle",
    x: x - 60,
    y: y - 40,
    width: 120,
    height: 80,
    rotation: 0,
    zIndex: nextZIndex(elements),
    fill: DEFAULT_FILL,
    stroke: DEFAULT_STROKE,
    strokeWidth: 0,
  };
}

export function createEllipse(elements: DesignElement[], x: number, y: number): EllipseElement {
  return {
    id: crypto.randomUUID(),
    type: "ellipse",
    x: x - 60,
    y: y - 60,
    width: 120,
    height: 120,
    rotation: 0,
    zIndex: nextZIndex(elements),
    fill: DEFAULT_FILL,
    stroke: DEFAULT_STROKE,
    strokeWidth: 0,
  };
}

export function createText(elements: DesignElement[], x: number, y: number): TextElement {
  return {
    id: crypto.randomUUID(),
    type: "text",
    x: x - 80,
    y: y - 16,
    width: 160,
    height: 32,
    rotation: 0,
    zIndex: nextZIndex(elements),
    fill: "#0b0e14",
    stroke: "",
    strokeWidth: 0,
    text: "Double-click to edit",
    fontFamily: "IBM Plex Sans",
    fontSize: 20,
    fontWeight: 400,
  };
}
