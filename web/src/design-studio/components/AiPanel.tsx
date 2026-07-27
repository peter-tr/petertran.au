import { AI_STYLE_PRESETS } from "../lib/ai-styles";

export interface AiMessage {
  id: string;
  prompt: string;
}

interface AiPanelProps {
  messages: AiMessage[];
  prompt: string;
  onPromptChange: (value: string) => void;
  onSend: () => void;
  generating: boolean;
  error: string | null;
  hasDraft: boolean;
  onAccept: () => void;
  onDiscard: () => void;
  style: string;
  onStyleChange: (style: string) => void;
  onClose: () => void;
}

// A persistent chat-style panel, not a one-shot form - it stays open across
// multiple generate calls so a prompt can be followed by refinements ("make
// it bigger", "change the colors") against the same draft, rather than the
// user having to reopen a form and start over each time. Provider/model
// configuration lives only on the dedicated settings page (see
// DesignStudioSettingsPage) - it's a global, not per-design, setting and
// doesn't need a second picker duplicated in here. Rendered in place of the
// Layers/Property panels in the side-panels column while open (see
// EditorWorkspace) rather than appended below the whole workspace - that
// placement made the prompt input/Send button easy to miss below the fold;
// swapping it into the always-visible side column keeps it in view without
// pushing the canvas/toolbar down.
export default function AiPanel({
  messages,
  prompt,
  onPromptChange,
  onSend,
  generating,
  error,
  hasDraft,
  onAccept,
  onDiscard,
  style,
  onStyleChange,
  onClose,
}: AiPanelProps) {
  return (
    <div className="design-studio-ai-panel">
      <div className="design-studio-ai-panel-header">
        <h2>Generate with AI</h2>
        <button type="button" className="design-studio-ai-panel-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="design-studio-ai-panel-log">
        {messages.length === 0 && (
          <p className="design-studio-empty">
            Describe what you want, e.g. “bold sale poster in teal and orange”. Once a draft appears, keep
            typing to refine it.
          </p>
        )}
        {messages.map((message) => (
          <p key={message.id} className="design-studio-ai-panel-message">
            {message.prompt}
          </p>
        ))}
      </div>
      {error && <p className="status-line">// {error}</p>}
      <div className="design-studio-ai-panel-styles" role="radiogroup" aria-label="AI style preset">
        {AI_STYLE_PRESETS.map((preset) => (
          <button
            key={preset.key}
            type="button"
            role="radio"
            aria-checked={style === preset.key}
            className={
              "design-studio-ai-style-chip" +
              (style === preset.key ? " design-studio-ai-style-chip-active" : "")
            }
            onClick={() => onStyleChange(preset.key)}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="design-studio-ai-panel-input">
        <textarea
          rows={3}
          placeholder={hasDraft ? "Refine the draft…" : "Describe what you want…"}
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter inserts a newline - the usual
            // chat-input convention, and necessary now that this is a
            // multi-line textarea rather than a single-line input.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          aria-label="AI design prompt"
        />
        <button type="button" onClick={onSend} disabled={generating || !prompt.trim()}>
          {generating ? "Generating…" : "Send"}
        </button>
      </div>
      {hasDraft && (
        <div className="design-studio-ai-panel-actions">
          <button type="button" className="design-studio-ai-discard" onClick={onDiscard}>
            Discard
          </button>
          <button type="button" className="design-studio-ai-accept" onClick={onAccept}>
            Accept
          </button>
        </div>
      )}
    </div>
  );
}
