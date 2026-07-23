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
        <input
          type="text"
          placeholder={hasDraft ? "Refine the draft…" : "Describe what you want…"}
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSend();
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
