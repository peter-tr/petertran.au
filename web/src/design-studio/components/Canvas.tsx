import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Stage, Layer, Rect, Ellipse, Arrow, Text, Transformer } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type { DesignElement } from "../lib/elements";

interface CanvasProps {
  width: number;
  height: number;
  elements: DesignElement[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (before: DesignElement, after: DesignElement) => void;
  // An AI-generated draft, rendered as a distinct dashed-outline overlay -
  // draggable/resizable like real elements, but tracked entirely separately
  // so nothing touches useEventHistory until the draft is accepted. Absent
  // (undefined) when there's no pending draft.
  draftElements?: DesignElement[];
  selectedDraftId?: string | null;
  onSelectDraft?: (id: string | null) => void;
  onDraftChange?: (before: DesignElement, after: DesignElement) => void;
  // Fired whenever the effective on-screen scale changes (auto-fit
  // recompute, or a manual zoomIn/zoomOut/zoomToFit call) - lets the
  // toolbar show a live "N%" readout without owning the scale itself.
  onScaleChange?: (scale: number) => void;
}

export interface CanvasHandle {
  exportPNG: (fileName: string) => Promise<void>;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomToFit: () => void;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

// Every element's x/y in our own data model is its bounding box's top-left
// corner, but Konva nodes here are positioned at their center (with
// offsetX/offsetY re-centering the draw) so rotation always pivots around
// the visual center - the same behaviour Figma/Canva's own rotate handles
// have, rather than Konva's per-shape default pivot (top-left for
// Rect/Text, already-center for Ellipse).
function centerOf(element: DesignElement): { x: number; y: number } {
  return { x: element.x + element.width / 2, y: element.y + element.height / 2 };
}

function topLeftFromCenterNode(node: Konva.Node, width: number, height: number): { x: number; y: number } {
  return { x: node.x() - width / 2, y: node.y() - height / 2 };
}

const Canvas = forwardRef<CanvasHandle, CanvasProps>(function Canvas(
  {
    width,
    height,
    elements,
    selectedId,
    onSelect,
    onChange,
    draftElements,
    selectedDraftId,
    onSelectDraft,
    onDraftChange,
    onScaleChange,
  },
  ref
) {
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const nodeRefs = useRef(new Map<string, Konva.Node>());
  const draftNodeRefs = useRef(new Map<string, Konva.Node>());
  const draftTransformerRef = useRef<Konva.Transformer>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const outerRef = useRef<HTMLDivElement>(null);
  // Shrinks the whole canvas (Stage + text-edit overlay) to fit narrow
  // viewports via a CSS transform rather than resizing the Stage itself, so
  // the element coordinate system (and PNG export resolution) stays at the
  // design's native width/height regardless of screen size. Safe to do
  // because Konva derives pointer positions from the ratio of the content
  // div's rendered (getBoundingClientRect) size to its layout (clientWidth)
  // size - see _getContentPosition in konva/lib/Stage.js - so it already
  // compensates for a CSS-transformed container; clicks/drags still land
  // correctly at any scale.
  const [fitScale, setFitScale] = useState(1);
  // null follows fitScale (the default, auto-fit behaviour); a number means
  // the user has manually zoomed via the toolbar and it now overrides the
  // auto-fit computation below, until they click the % readout to reset.
  const [zoomOverride, setZoomOverride] = useState<number | null>(null);
  const scale = zoomOverride ?? fitScale;

  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;

    // Fitting to available width alone is enough on a portrait phone, but
    // on a short/wide mobile-landscape viewport a width-only fit can still
    // leave the canvas tall enough to fill nearly the whole screen height,
    // pushing the toolbar/panels below it far off screen. Also cap by a
    // fraction of window height so there's always room left for the rest
    // of the editor.
    function recompute(containerWidth: number) {
      const heightBudget = window.innerHeight * 0.6;
      setFitScale(Math.min(1, containerWidth / width, heightBudget / height));
    }

    const observer = new ResizeObserver((entries) => {
      recompute(entries[0]?.contentRect.width ?? outer.clientWidth);
    });
    observer.observe(outer);

    const handleViewportResize = () => {
      recompute(outer.getBoundingClientRect().width);
    };
    window.addEventListener("resize", handleViewportResize);
    window.addEventListener("orientationchange", handleViewportResize);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", handleViewportResize);
      window.removeEventListener("orientationchange", handleViewportResize);
    };
  }, [width, height]);

  useEffect(() => {
    onScaleChange?.(scale);
  }, [scale, onScaleChange]);

  useImperativeHandle(ref, () => ({
    exportPNG: async (fileName: string) => {
      const stage = stageRef.current;
      if (!stage) return;

      // toBlob's PNG encoding runs via the browser's async canvas.toBlob
      // rather than synchronously on the main thread like toDataURL, so a
      // large/busy stage no longer freezes the UI while it encodes.
      const blob = (await stage.toBlob({ pixelRatio: 2, mimeType: "image/png" })) as Blob | null;
      if (!blob) return;

      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.download = fileName;
        link.href = url;
        link.click();
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    zoomIn: () => setZoomOverride((current) => Math.min(MAX_ZOOM, (current ?? scale) + ZOOM_STEP)),
    zoomOut: () => setZoomOverride((current) => Math.max(MIN_ZOOM, (current ?? scale) - ZOOM_STEP)),
    zoomToFit: () => setZoomOverride(null),
  }));

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;

    const node = selectedId ? nodeRefs.current.get(selectedId) : undefined;
    transformer.nodes(node ? [node] : []);
    transformer.getLayer()?.batchDraw();
  }, [selectedId, elements]);

  useEffect(() => {
    const transformer = draftTransformerRef.current;
    if (!transformer) return;

    const node = selectedDraftId ? draftNodeRefs.current.get(selectedDraftId) : undefined;
    transformer.nodes(node ? [node] : []);
    transformer.getLayer()?.batchDraw();
  }, [selectedDraftId, draftElements]);

  function handleDragEnd(element: DesignElement, e: KonvaEventObject<DragEvent>) {
    onChange(element, { ...element, ...topLeftFromCenterNode(e.target, element.width, element.height) });
  }

  function handleTransformEnd(element: DesignElement, e: KonvaEventObject<Event>) {
    const node = e.target;
    // Konva resizes by scaling the node rather than changing width/height
    // directly - bake the scale into our own width/height and reset the
    // node's scale to 1 so the next transform starts from a clean basis
    // instead of compounding on top of a stale scale factor.
    const width = Math.max(5, element.width * node.scaleX());
    const height = Math.max(5, element.height * node.scaleY());
    node.scaleX(1);
    node.scaleY(1);

    onChange(element, {
      ...element,
      ...topLeftFromCenterNode(node, width, height),
      width,
      height,
      rotation: node.rotation(),
    });
  }

  function handleDraftDragEnd(element: DesignElement, e: KonvaEventObject<DragEvent>) {
    onDraftChange?.(element, {
      ...element,
      ...topLeftFromCenterNode(e.target, element.width, element.height),
    });
  }

  function handleDraftTransformEnd(element: DesignElement, e: KonvaEventObject<Event>) {
    const node = e.target;
    const width = Math.max(5, element.width * node.scaleX());
    const height = Math.max(5, element.height * node.scaleY());
    node.scaleX(1);
    node.scaleY(1);

    onDraftChange?.(element, {
      ...element,
      ...topLeftFromCenterNode(node, width, height),
      width,
      height,
      rotation: node.rotation(),
    });
  }

  function startEditingText(element: DesignElement) {
    if (element.type !== "text") return;
    setEditingId(element.id);
    setEditingValue(element.text);
    onSelect(element.id);
  }

  function commitTextEdit() {
    const element = editingId ? elements.find((el) => el.id === editingId) : undefined;
    if (element?.type === "text" && element.text !== editingValue) {
      onChange(element, { ...element, text: editingValue });
    }
    setEditingId(null);
  }

  const sorted = [...elements].sort((a, b) => a.zIndex - b.zIndex);
  const editingElement = editingId ? elements.find((el) => el.id === editingId) : undefined;

  return (
    <div className="design-studio-canvas-outer" ref={outerRef}>
      <div className="design-studio-scale-box" style={{ width: width * scale, height: height * scale }}>
        <div
          className="design-studio-stage-wrapper"
          style={{ width, height, transform: `scale(${scale})`, transformOrigin: "top left" }}
        >
          <Stage
            ref={stageRef}
            width={width}
            height={height}
            className="design-studio-stage"
            onMouseDown={(e) => {
              if (e.target === e.target.getStage()) {
                onSelect(null);
                onSelectDraft?.(null);
              }
            }}
          >
            {/* Dimmed while a draft overlay is showing (see the second Layer
                below) - the draft is a preview of the complete post-accept
                state, not an addition to this one, so at full strength the two
                fully-opaque layers just visually duplicate every element the
                draft echoed back unchanged. Full opacity again once there's no
                draft. */}
            <Layer opacity={draftElements && draftElements.length > 0 ? 0.35 : 1}>
              <Rect x={0} y={0} width={width} height={height} fill="#ffffff" listening={false} />
              {sorted.map((element) => {
                const { x, y } = centerOf(element);
                const common = {
                  key: element.id,
                  ref: (node: Konva.Node | null) => {
                    if (node) nodeRefs.current.set(element.id, node);
                    else nodeRefs.current.delete(element.id);
                  },
                  x,
                  y,
                  rotation: element.rotation,
                  fill: element.fill,
                  stroke: element.stroke || undefined,
                  strokeWidth: element.strokeWidth,
                  draggable: true,
                  onClick: () => onSelect(element.id),
                  onTap: () => onSelect(element.id),
                  onDragEnd: (e: KonvaEventObject<DragEvent>) => handleDragEnd(element, e),
                  onTransformEnd: (e: KonvaEventObject<Event>) => handleTransformEnd(element, e),
                };

                if (element.type === "rectangle") {
                  return (
                    <Rect
                      {...common}
                      width={element.width}
                      height={element.height}
                      offsetX={element.width / 2}
                      offsetY={element.height / 2}
                    />
                  );
                }

                if (element.type === "ellipse") {
                  return <Ellipse {...common} radiusX={element.width / 2} radiusY={element.height / 2} />;
                }

                if (element.type === "arrow") {
                  return (
                    <Arrow
                      {...common}
                      points={[0, 0, element.width, element.height]}
                      offsetX={element.width / 2}
                      offsetY={element.height / 2}
                      pointerLength={Math.max(8, element.strokeWidth * 2.5)}
                      pointerWidth={Math.max(8, element.strokeWidth * 2.5)}
                    />
                  );
                }

                return (
                  <Text
                    {...common}
                    width={element.width}
                    height={element.height}
                    offsetX={element.width / 2}
                    offsetY={element.height / 2}
                    text={element.text}
                    fontFamily={element.fontFamily}
                    fontSize={element.fontSize}
                    fontStyle={element.fontWeight >= 600 ? "bold" : "normal"}
                    visible={element.id !== editingId}
                    onDblClick={() => startEditingText(element)}
                    onDblTap={() => startEditingText(element)}
                  />
                );
              })}
              <Transformer ref={transformerRef} rotateEnabled />
            </Layer>

            {/* AI-generated draft overlay - a distinct dashed-outline layer,
                draggable/resizable via its own Transformer, but never touching
                useEventHistory (see EditorWorkspace's draftElements state)
                until the user explicitly accepts it. */}
            {draftElements && draftElements.length > 0 && (
              <Layer>
                {[...draftElements]
                  .sort((a, b) => a.zIndex - b.zIndex)
                  .map((element) => {
                    const { x, y } = centerOf(element);
                    const common = {
                      key: element.id,
                      ref: (node: Konva.Node | null) => {
                        if (node) draftNodeRefs.current.set(element.id, node);
                        else draftNodeRefs.current.delete(element.id);
                      },
                      x,
                      y,
                      rotation: element.rotation,
                      fill: element.fill,
                      // A thin outline plus a faint glow (via
                      // shadowColor/shadowBlur) rather than relying on stroke
                      // color alone for visibility - a plain outline can blend
                      // into a design that happens to share its hue, but the
                      // glow reads regardless of the underlying palette. Kept
                      // deliberately subtle (low blur/opacity, thin stroke) -
                      // this overlay sits on top of the real canvas the whole
                      // time a draft is pending, so a heavy glow read as
                      // visual noise rather than a lightweight preview. Konva
                      // draws to canvas, so this can't reference the CSS
                      // custom property directly - #63c7be is
                      // design-studio.css's --type token, the app's own
                      // accent, not an invented color.
                      stroke: "#63c7be",
                      strokeWidth: Math.max(element.strokeWidth, 1.5),
                      dash: [8, 6],
                      shadowColor: "#63c7be",
                      shadowBlur: 5,
                      shadowOpacity: 0.3,
                      draggable: true,
                      onClick: () => onSelectDraft?.(element.id),
                      onTap: () => onSelectDraft?.(element.id),
                      onDragEnd: (e: KonvaEventObject<DragEvent>) => handleDraftDragEnd(element, e),
                      onTransformEnd: (e: KonvaEventObject<Event>) => handleDraftTransformEnd(element, e),
                    };

                    if (element.type === "rectangle") {
                      return (
                        <Rect
                          {...common}
                          width={element.width}
                          height={element.height}
                          offsetX={element.width / 2}
                          offsetY={element.height / 2}
                        />
                      );
                    }

                    if (element.type === "ellipse") {
                      return <Ellipse {...common} radiusX={element.width / 2} radiusY={element.height / 2} />;
                    }

                    if (element.type === "arrow") {
                      return (
                        <Arrow
                          {...common}
                          points={[0, 0, element.width, element.height]}
                          offsetX={element.width / 2}
                          offsetY={element.height / 2}
                          pointerLength={12}
                          pointerWidth={12}
                        />
                      );
                    }

                    return (
                      <Text
                        {...common}
                        width={element.width}
                        height={element.height}
                        offsetX={element.width / 2}
                        offsetY={element.height / 2}
                        text={element.text}
                        fontFamily={element.fontFamily}
                        fontSize={element.fontSize}
                        fontStyle={element.fontWeight >= 600 ? "bold" : "normal"}
                      />
                    );
                  })}
                <Transformer ref={draftTransformerRef} rotateEnabled />
              </Layer>
            )}
          </Stage>

          {/* Konva has no native text editing - swap in a plain HTML textarea
              over the hidden Konva Text node while editing, matching Konva's
              own documented "editable text" recipe. Deliberately axis-aligned
              (ignores the element's rotation) - handling a rotated textarea
              overlay is a well-known can of worms this MVP doesn't need to
              open. Sits inside the same scaled wrapper as the Stage, so it
              tracks the canvas's on-screen size/position at any zoom level
              without needing its own scale math. */}
          {editingElement?.type === "text" && (
            <textarea
              autoFocus
              className="design-studio-text-editor"
              style={{
                top: editingElement.y,
                left: editingElement.x,
                width: editingElement.width,
                height: editingElement.height,
                fontSize: editingElement.fontSize,
                fontFamily: editingElement.fontFamily,
                fontWeight: editingElement.fontWeight,
                color: editingElement.fill,
              }}
              value={editingValue}
              onChange={(e) => setEditingValue(e.target.value)}
              onBlur={commitTextEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  commitTextEdit();
                } else if (e.key === "Escape") {
                  setEditingId(null);
                }
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
});

export default Canvas;
