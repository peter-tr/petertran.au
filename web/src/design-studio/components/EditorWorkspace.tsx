import { useCallback, useEffect, useRef, useState } from "react";
import Canvas, { type CanvasHandle } from "./Canvas";
import Toolbar from "./Toolbar";
import LayersPanel from "./LayersPanel";
import PropertyPanel from "./PropertyPanel";
import AiPanel, { type AiMessage } from "./AiPanel";
import { useEventHistory } from "../lib/history/useEventHistory";
import type { HistoryEvent } from "../lib/history/reducer";
import {
  createRectangle,
  createEllipse,
  createText,
  type DesignElement,
  type ElementType,
} from "../lib/elements";
import { toElementInput, fromWireElement } from "../lib/serialization";
import { saveDesign, saveAsTemplate, generateDesignElements, type Design } from "../api";

interface EditorWorkspaceProps {
  designId: string | undefined;
  width: number;
  height: number;
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
  width,
  height,
  initialEvents,
  initialName,
  onSaved,
}: EditorWorkspaceProps) {
  const { elements, dispatch, undo, redo, canUndo, canRedo } = useEventHistory(initialEvents);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [templateCategory, setTemplateCategory] = useState("");
  const [templateTags, setTemplateTags] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateMessage, setTemplateMessage] = useState<string | null>(null);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiMessages, setAiMessages] = useState<AiMessage[]>([]);
  const [aiPrompt, setAiPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  // A pending AI-generated draft - kept entirely outside useEventHistory
  // (see the reducer.ts doc comment on HistoryEvent) so nothing is
  // undoable/persisted until the user explicitly accepts it. Re-sent as
  // currentElements on the next prompt, so a follow-up like "make it
  // bigger" refines this draft instead of starting a fresh generation.
  const [draftElements, setDraftElements] = useState<DesignElement[] | null>(null);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const canvasRef = useRef<CanvasHandle>(null);

  const selectedElement = elements.find((el) => el.id === selectedId);

  const handleAdd = useCallback(
    (type: ElementType) => {
      const centerX = width / 2;
      const centerY = height / 2;
      const created =
        type === "rectangle"
          ? createRectangle(elements, centerX, centerY)
          : type === "ellipse"
            ? createEllipse(elements, centerX, centerY)
            : createText(elements, centerX, centerY);

      dispatch({ type: "add", element: created });
      setSelectedId(created.id);
    },
    [elements, dispatch, width, height]
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
        width,
        height,
        elements: elements.map(toElementInput),
      });
      onSaved(saved);
    } catch {
      setSaveError("Couldn't save this design - try again.");
    } finally {
      setSaving(false);
    }
  }, [designId, name, elements, onSaved, width, height]);

  const handleSaveAsTemplate = useCallback(async () => {
    if (!templateCategory.trim()) return;

    setSavingTemplate(true);
    setTemplateMessage(null);
    try {
      await saveAsTemplate({
        name: name || "Untitled template",
        category: templateCategory.trim(),
        tags: templateTags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        width,
        height,
        elements: elements.map(toElementInput),
      });
      setTemplateMessage("Saved as a template.");
      setShowTemplateForm(false);
      setTemplateCategory("");
      setTemplateTags("");
    } catch {
      setTemplateMessage("Couldn't save this as a template - try again.");
    } finally {
      setSavingTemplate(false);
    }
  }, [name, templateCategory, templateTags, elements, width, height]);

  const handleGenerate = useCallback(async () => {
    const trimmed = aiPrompt.trim();
    if (!trimmed) return;

    setGenerating(true);
    setAiError(null);
    try {
      const generated = await generateDesignElements({
        prompt: trimmed,
        width,
        height,
        // Re-sending the current draft (if any) turns this into a
        // refinement of it rather than a fresh generation - see the
        // backend's isRefinement branch in generate-elements.ts.
        currentElements: draftElements ? draftElements.map(toElementInput) : undefined,
      });
      setDraftElements(generated.map(fromWireElement));
      setSelectedDraftId(null);
      setAiMessages((current) => [...current, { id: crypto.randomUUID(), prompt: trimmed }]);
      setAiPrompt("");
    } catch {
      setAiError("Couldn't generate a design - try a different prompt.");
    } finally {
      setGenerating(false);
    }
  }, [aiPrompt, width, height, draftElements]);

  const handleAcceptDraft = useCallback(() => {
    if (!draftElements) return;

    for (const element of draftElements) dispatch({ type: "add", element });
    setDraftElements(null);
    setSelectedDraftId(null);
    setAiMessages([]);
    setShowAiPanel(false);
  }, [draftElements, dispatch]);

  const handleDiscardDraft = useCallback(() => {
    setDraftElements(null);
    setSelectedDraftId(null);
    setAiMessages([]);
  }, []);

  const handleDraftChange = useCallback((before: DesignElement, after: DesignElement) => {
    setDraftElements((current) => current?.map((el) => (el.id === before.id ? after : el)) ?? null);
  }, []);

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
          <button type="button" onClick={() => setShowTemplateForm((v) => !v)}>
            Save as template
          </button>
          <button type="button" onClick={() => setShowAiPanel((v) => !v)}>
            Generate with AI
          </button>
        </div>
      </header>
      {saveError && <p className="status-line">// {saveError}</p>}
      {showTemplateForm && (
        <div className="design-studio-template-form">
          <input
            type="text"
            placeholder="Category (e.g. Poster)"
            value={templateCategory}
            onChange={(e) => setTemplateCategory(e.target.value)}
            aria-label="Template category"
          />
          <input
            type="text"
            placeholder="Tags, comma separated"
            value={templateTags}
            onChange={(e) => setTemplateTags(e.target.value)}
            aria-label="Template tags"
          />
          <button
            type="button"
            onClick={handleSaveAsTemplate}
            disabled={savingTemplate || !templateCategory.trim()}
          >
            {savingTemplate ? "Saving…" : "Save template"}
          </button>
          <button type="button" onClick={() => setShowTemplateForm(false)}>
            Cancel
          </button>
        </div>
      )}
      {templateMessage && <p className="status-line">// {templateMessage}</p>}
      <div className="design-studio-workspace">
        <Toolbar onAdd={handleAdd} onExport={() => canvasRef.current?.exportPNG()} />
        <div className="design-studio-canvas-frame">
          <Canvas
            ref={canvasRef}
            width={width}
            height={height}
            elements={elements}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onChange={handleChange}
            draftElements={draftElements ?? undefined}
            selectedDraftId={selectedDraftId}
            onSelectDraft={setSelectedDraftId}
            onDraftChange={handleDraftChange}
          />
        </div>
        <div className="design-studio-side-panels">
          {showAiPanel && (
            <AiPanel
              messages={aiMessages}
              prompt={aiPrompt}
              onPromptChange={setAiPrompt}
              onSend={handleGenerate}
              generating={generating}
              error={aiError}
              hasDraft={!!draftElements}
              onAccept={handleAcceptDraft}
              onDiscard={handleDiscardDraft}
            />
          )}
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
