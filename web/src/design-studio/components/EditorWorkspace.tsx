import { useCallback, useEffect, useRef, useState } from "react";
import Canvas, { CANVAS_WIDTH, CANVAS_HEIGHT, type CanvasHandle } from "./Canvas";
import Toolbar from "./Toolbar";
import LayersPanel from "./LayersPanel";
import PropertyPanel from "./PropertyPanel";
import { useEventHistory } from "../lib/history/useEventHistory";
import type { HistoryEvent } from "../lib/history/reducer";
import {
  createRectangle,
  createEllipse,
  createText,
  type DesignElement,
  type ElementType,
} from "../lib/elements";
import { toElementInput } from "../lib/serialization";
import { saveDesign, type Design } from "../api";

interface EditorWorkspaceProps {
  designId: string | undefined;
  initialEvents: HistoryEvent[];
  initialName: string;
  onSaved: (design: Design) => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export default function EditorWorkspace({
  designId,
  initialEvents,
  initialName,
  onSaved,
}: EditorWorkspaceProps) {
  const { elements, dispatch, undo, redo, canUndo, canRedo } = useEventHistory(initialEvents);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const canvasRef = useRef<CanvasHandle>(null);

  const selectedElement = elements.find((el) => el.id === selectedId);

  const handleAdd = useCallback(
    (type: ElementType) => {
      const centerX = CANVAS_WIDTH / 2;
      const centerY = CANVAS_HEIGHT / 2;
      const created =
        type === "rectangle"
          ? createRectangle(elements, centerX, centerY)
          : type === "ellipse"
            ? createEllipse(elements, centerX, centerY)
            : createText(elements, centerX, centerY);

      dispatch({ type: "add", element: created });
      setSelectedId(created.id);
    },
    [elements, dispatch]
  );

  const handleChange = useCallback(
    (before: DesignElement, after: DesignElement) => {
      dispatch({ type: "update", id: before.id, before, after });
    },
    [dispatch]
  );

  const handlePropertyChange = useCallback(
    (after: DesignElement) => {
      const before = elements.find((el) => el.id === after.id);
      if (before) dispatch({ type: "update", id: after.id, before, after });
    },
    [elements, dispatch]
  );

  const handleReorder = useCallback((order: string[]) => dispatch({ type: "reorder", order }), [dispatch]);

  const handleDuplicate = useCallback(
    (id: string) => {
      const original = elements.find((el) => el.id === id);
      if (!original) return;

      const zIndex = elements.length === 0 ? 0 : Math.max(...elements.map((el) => el.zIndex)) + 1;
      const clone: DesignElement = {
        ...original,
        id: crypto.randomUUID(),
        x: original.x + 20,
        y: original.y + 20,
        zIndex,
      };
      dispatch({ type: "add", element: clone });
      setSelectedId(clone.id);
    },
    [elements, dispatch]
  );

  const handleDelete = useCallback(
    (id: string) => {
      const element = elements.find((el) => el.id === id);
      if (!element) return;

      dispatch({ type: "remove", element });
      setSelectedId((current) => (current === id ? null : current));
    },
    [elements, dispatch]
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await saveDesign({
        id: designId,
        name,
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        elements: elements.map(toElementInput),
      });
      onSaved(saved);
    } catch {
      setSaveError("Couldn't save this design - try again.");
    } finally {
      setSaving(false);
    }
  }, [designId, name, elements, onSaved]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;

      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (meta && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSave();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        handleDelete(selectedId);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo, selectedId, handleDelete, handleSave]);

  return (
    <div className="design-studio-editor">
      <header className="design-studio-head">
        <input
          className="design-studio-name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Design name"
        />
        <div className="design-studio-history-controls">
          <button type="button" onClick={undo} disabled={!canUndo}>
            Undo
          </button>
          <button type="button" onClick={redo} disabled={!canRedo}>
            Redo
          </button>
          <button type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>
      {saveError && <p className="status-line">// {saveError}</p>}
      <div className="design-studio-workspace">
        <Toolbar onAdd={handleAdd} onExport={() => canvasRef.current?.exportPNG()} />
        <div className="design-studio-canvas-frame">
          <Canvas
            ref={canvasRef}
            elements={elements}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onChange={handleChange}
          />
        </div>
        <div className="design-studio-side-panels">
          <LayersPanel
            elements={elements}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onReorder={handleReorder}
            onDuplicate={handleDuplicate}
            onDelete={handleDelete}
          />
          <PropertyPanel element={selectedElement} onChange={handlePropertyChange} />
        </div>
      </div>
    </div>
  );
}
