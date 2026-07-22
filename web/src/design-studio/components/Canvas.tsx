import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Stage, Layer, Rect, Ellipse, Text, Transformer } from "react-konva";
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
}

export interface CanvasHandle {
  exportPNG: () => void;
}

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

  useImperativeHandle(ref, () => ({
    exportPNG: () => {
      const stage = stageRef.current;
      if (!stage) return;

      const link = document.createElement("a");
      link.download = "design.png";
      link.href = stage.toDataURL({ pixelRatio: 2 });
      link.click();
    },
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
    if (element && element.type === "text" && element.text !== editingValue) {
      onChange(element, { ...element, text: editingValue });
    }
    setEditingId(null);
  }

  const sorted = [...elements].sort((a, b) => a.zIndex - b.zIndex);
  const editingElement = editingId ? elements.find((el) => el.id === editingId) : undefined;

  return (
    <div className="design-studio-stage-wrapper">
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
        <Layer>
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
                  stroke: "#f2a93b",
                  strokeWidth: Math.max(element.strokeWidth, 2),
                  dash: [10, 6],
                  opacity: 0.85,
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
          open. */}
      {editingElement && editingElement.type === "text" && (
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
  );
});

export default Canvas;
