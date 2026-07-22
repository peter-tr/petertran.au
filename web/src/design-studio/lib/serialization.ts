import { DesignElementType } from "../api-schema-types.generated";
import type { DesignElementInput, Design } from "../api";
import type { DesignElement, ElementType } from "./elements";

const TYPE_TO_WIRE: Record<ElementType, DesignElementType> = {
  rectangle: DesignElementType.Rectangle,
  ellipse: DesignElementType.Ellipse,
  text: DesignElementType.Text,
};

const TYPE_FROM_WIRE: Record<DesignElementType, ElementType> = {
  [DesignElementType.Rectangle]: "rectangle",
  [DesignElementType.Ellipse]: "ellipse",
  [DesignElementType.Text]: "text",
};

export function toElementInput(element: DesignElement): DesignElementInput {
  return {
    id: element.id,
    type: TYPE_TO_WIRE[element.type],
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    rotation: element.rotation,
    zIndex: element.zIndex,
    fill: element.fill,
    stroke: element.stroke,
    strokeWidth: element.strokeWidth,
    text: element.type === "text" ? element.text : undefined,
    fontFamily: element.type === "text" ? element.fontFamily : undefined,
    fontSize: element.type === "text" ? element.fontSize : undefined,
    fontWeight: element.type === "text" ? element.fontWeight : undefined,
  };
}

export function fromWireElement(element: Design["elements"][number]): DesignElement {
  const type = TYPE_FROM_WIRE[element.type];
  const base = {
    id: element.id,
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    rotation: element.rotation,
    zIndex: element.zIndex,
    fill: element.fill,
    stroke: element.stroke,
    strokeWidth: element.strokeWidth,
  };

  if (type === "text") {
    return {
      ...base,
      type: "text",
      text: element.text ?? "",
      fontFamily: element.fontFamily ?? "IBM Plex Sans",
      fontSize: element.fontSize ?? 20,
      fontWeight: element.fontWeight ?? 400,
    };
  }

  return { ...base, type };
}
