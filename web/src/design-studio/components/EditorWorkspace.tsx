import { useCallback, useEffect, useRef, useState } from "react";
import Canvas, { type CanvasHandle } from "./Canvas";
import Toolbar from "./Toolbar";
import LayersPanel from "./LayersPanel";
import PropertyPanel from "./PropertyPanel";
import AiPanel, { type AiMessage } from "./AiPanel";
import { useEventHistory } from "../lib/history/useEventHistory";
import type { HistoryEvent } from "../lib/history/reducer";
import { createElementByType, type DesignElement, type ElementType } from "../lib/elements";
import { toElementInput, fromWireElement } from "../lib/serialization";
import { TOOLS, EXPORT_SHORTCUT_KEY, toExportFileName } from "../lib/tools";
import { AI_STYLE_PRESETS } from "../lib/ai-styles";
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
  const [exporting, setExporting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [templateCategory, setTemplateCategory] = useState("");
  const [templateTags, setTemplateTags] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateMessage, setTemplateMessage] = useState<string | null>(null);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiMessages, setAiMessages] = useState<AiMessage[]>([]);
  const [aiPrompt, setAiPrompt] = useState("");
  // The style chip selected in the panel ("none" by default) - its
  // descriptor is appended to the prompt at send time (see handleGenerate)
  // rather than edited into the textarea itself, so switching styles
  // between refinements doesn't require the user to hunt for and replace
  // a phrase they didn't type.
  const [aiStyle, setAiStyle] = useState("none");
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
  // Mirrors Canvas's own effective scale (auto-fit unless overridden by the
  // zoom controls below) purely for the toolbar's % readout - Canvas remains
  // the source of truth, this just reflects it via onScaleChange.
  const [zoomPercent, setZoomPercent] = useState(100);
  // A vertical rail reads better beside a tall portrait design (resume,
  // poster) than the horizontal strip underneath it; a wide landscape
  // design (presentation) keeps the horizontal strip. Square designs fall
  // back to the horizontal layout too - only a genuinely taller-than-wide
  // canvas benefits from the side rail.
  const isPortrait = height > width;

  const selectedElement = elements.find((el) => el.id === selectedId);

  const handleAdd = useCallback(
    (type: ElementType) => {
      const created = createElementByType(type, elements, width / 2, height / 2);

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

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      await canvasRef.current?.exportPNG(toExportFileName(name));
    } finally {
      setExporting(false);
    }
  }, [name]);

  const handleZoomIn = useCallback(() => canvasRef.current?.zoomIn(), []);
  const handleZoomOut = useCallback(() => canvasRef.current?.zoomOut(), []);
  const handleZoomReset = useCallback(() => canvasRef.current?.zoomToFit(), []);

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
      // Ground generation in whatever's already there: the AI's own
      // in-progress draft if one exists (continuing a refinement), else
      // the real committed elements on the canvas - so a first prompt on
      // a non-empty design is a refinement of what's already there
      // instead of an independent draft the model has no idea sits on
      // top of existing content. See the backend's isRefinement branch
      // in generate-elements.ts.
      const baseElements = draftElements ?? (elements.length > 0 ? elements : undefined);
      // The style descriptor is appended to what's actually sent, not
      // stored in aiPrompt/shown in the log - so switching styles between
      // refinements doesn't clutter the visible prompt history with a
      // repeated style phrase the user never typed.
      const styleDescriptor = AI_STYLE_PRESETS.find((preset) => preset.key === aiStyle)?.descriptor;
      const finalPrompt = styleDescriptor ? `${trimmed} (style: ${styleDescriptor})` : trimmed;
      const generated = await generateDesignElements({
        prompt: finalPrompt,
        width,
        height,
        currentElements: baseElements?.map(toElementInput),
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
  }, [aiPrompt, width, height, draftElements, elements, aiStyle]);

  const handleAcceptDraft = useCallback(() => {
    if (!draftElements) return;

    // The draft may echo back elements already on the real canvas (when
    // generation was grounded in them - see handleGenerate above) under
    // fresh ids of their own, since the backend never trusts the model's
    // identity for existing elements (see sanitizeElement's doc comment).
    // Replace rather than append, or accepting would duplicate anything
    // the draft echoed back unchanged. A no-op remove loop when the
    // canvas was empty to begin with.
    for (const element of elements) dispatch({ type: "remove", element });
    for (const element of draftElements) dispatch({ type: "add", element });
    setDraftElements(null);
    setSelectedDraftId(null);
    setAiMessages([]);
    setShowAiPanel(false);
  }, [draftElements, elements, dispatch]);

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
      } else if (e.key === EXPORT_SHORTCUT_KEY) {
        e.preventDefault();
        canvasRef.current?.exportPNG(toExportFileName(name));
      } else {
        const tool = TOOLS.find((t) => t.key === e.key);
        if (tool) {
          e.preventDefault();
          handleAdd(tool.type);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo, selectedId, handleDelete, handleSave, handleAdd, name]);

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
      <div className={"design-studio-ai-drawer" + (showAiPanel ? " design-studio-ai-drawer--open" : "")}>
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
          style={aiStyle}
          onStyleChange={setAiStyle}
          onClose={() => setShowAiPanel(false)}
        />
      </div>
      <div className="design-studio-workspace">
        <div
          className={
            "design-studio-canvas-column" + (isPortrait ? " design-studio-canvas-column--portrait" : "")
          }
        >
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
              onScaleChange={(scale) => setZoomPercent(Math.round(scale * 100))}
            />
          </div>
          <Toolbar
            onAdd={handleAdd}
            onExport={handleExport}
            exporting={exporting}
            zoomPercent={zoomPercent}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onZoomReset={handleZoomReset}
            vertical={isPortrait}
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
