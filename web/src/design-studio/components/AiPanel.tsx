import type { AiSettings, AiSettingsInput } from "../api";

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
  // null until the first load resolves (see EditorWorkspace's lazy fetch) -
  // the picker just doesn't render until then rather than showing a
  // placeholder for a setting that isn't per-design anyway.
  aiSettings: AiSettings | null;
  onAiSettingsChange: (input: AiSettingsInput) => void;
}

// A persistent chat-style panel, not a one-shot form - it stays open across
// multiple generate calls so a prompt can be followed by refinements ("make
// it bigger", "change the colors") against the same draft, rather than the
// user having to reopen a form and start over each time.
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
  aiSettings,
  onAiSettingsChange,
}: AiPanelProps) {
  return (
    <div className="design-studio-ai-panel">
      <div className="design-studio-ai-panel-header">
        <h2>Generate with AI</h2>
        {hasDraft && (
          <div className="design-studio-ai-panel-actions">
            <button type="button" onClick={onDiscard}>
              Discard
            </button>
            <button type="button" onClick={onAccept}>
              Accept
            </button>
          </div>
        )}
      </div>
      {aiSettings && (
        <div className="design-studio-ai-panel-settings">
          <label>
            Provider{" "}
            <select
              aria-label="AI provider"
              value={aiSettings.provider}
              onChange={(e) => {
                const provider = e.target.value as AiSettings["provider"];
                // Bedrock doesn't currently support this feature's
                // structured output for Haiku 4.5 (see generate-elements.ts)
                // - steer off it automatically rather than letting the user
                // land on a combination that's guaranteed to fail.
                if (provider === "BEDROCK" && aiSettings.modelTier === "HAIKU") {
                  onAiSettingsChange({ provider, modelTier: "SONNET" as AiSettings["modelTier"] });
                } else {
                  onAiSettingsChange({ provider });
                }
              }}
            >
              <option value="ANTHROPIC">Direct Anthropic API</option>
              <option value="BEDROCK">AWS Bedrock</option>
            </select>
          </label>
          <label>
            Model{" "}
            <select
              aria-label="AI model"
              value={aiSettings.modelTier}
              onChange={(e) => onAiSettingsChange({ modelTier: e.target.value as AiSettings["modelTier"] })}
            >
              <option value="HAIKU" disabled={aiSettings.provider === "BEDROCK"}>
                Haiku 4.5 (fast){aiSettings.provider === "BEDROCK" ? " - not available on Bedrock" : ""}
              </option>
              <option value="SONNET">Sonnet 4.6 (better quality)</option>
            </select>
          </label>
        </div>
      )}
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
    </div>
  );
}
