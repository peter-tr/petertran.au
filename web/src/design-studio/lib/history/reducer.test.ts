import { describe, expect, it } from "vitest";
import { applyEvent } from "./reducer";
import { createRectangle, createEllipse } from "../elements";

describe("applyEvent", () => {
  it("appends the element on add", () => {
    const rect = createRectangle([], 100, 100);
    expect(applyEvent([], { type: "add", element: rect })).toEqual([rect]);
  });

  it("merges the after payload onto the matching element on update", () => {
    const rect = createRectangle([], 100, 100);
    const result = applyEvent([rect], {
      type: "update",
      id: rect.id,
      before: { fill: rect.fill },
      after: { fill: "#ff0000" },
    });

    expect(result).toEqual([{ ...rect, fill: "#ff0000" }]);
  });

  it("leaves other elements untouched on update", () => {
    const rect = createRectangle([], 100, 100);
    const ellipse = createEllipse([rect], 200, 200);
    const result = applyEvent([rect, ellipse], {
      type: "update",
      id: rect.id,
      before: { fill: rect.fill },
      after: { fill: "#ff0000" },
    });

    expect(result).toEqual([{ ...rect, fill: "#ff0000" }, ellipse]);
  });

  it("removes the matching element", () => {
    const rect = createRectangle([], 100, 100);
    const ellipse = createEllipse([rect], 200, 200);
    expect(applyEvent([rect, ellipse], { type: "remove", element: rect })).toEqual([ellipse]);
  });

  it("reassigns zIndex according to the given order", () => {
    const rect = createRectangle([], 100, 100);
    const ellipse = createEllipse([rect], 200, 200);
    const result = applyEvent([rect, ellipse], { type: "reorder", order: [ellipse.id, rect.id] });

    expect(result.find((el) => el.id === ellipse.id)?.zIndex).toBe(0);
    expect(result.find((el) => el.id === rect.id)?.zIndex).toBe(1);
  });
});
