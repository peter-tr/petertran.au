import { useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import {
  runPantryQuery,
  PARSE_COMMAND_QUERY,
  PANTRY_ACTION_MUTATIONS,
  type ParseCommandResult,
  type ParsedCommand,
} from "../lib/pantryGraphql";

type Status = "idle" | "thinking" | "confirming" | "error";

interface PantryCommandBarProps {
  onChanged: () => void;
}

// Enum-valued fields render unquoted in GraphQL (e.g. FRIDGE, not "FRIDGE") -
// everything else follows normal JSON-ish literal formatting.
const ENUM_FIELDS = new Set(["location"]);

function formatGraphQLValue(key: string | null, value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return key && ENUM_FIELDS.has(key) ? value : JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => formatGraphQLValue(null, v)).join(", ")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${formatGraphQLValue(k, v)}`)
      .join(", ");
    return `{ ${entries} }`;
  }
  return JSON.stringify(value);
}

// Reconstructs a readable GraphQL mutation from the server's {mutationName,
// argsJson} pair, purely for the "view mutation" transparency panel - this
// text is never sent anywhere, the real call uses PANTRY_ACTION_MUTATIONS.
function formatMutationPreview(mutationName: string, argsJson: string): string {
  try {
    const args = JSON.parse(argsJson) as Record<string, unknown>;
    const argsText = Object.entries(args)
      .map(([k, v]) => `${k}: ${formatGraphQLValue(k, v)}`)
      .join(", ");
    return `mutation {\n  ${mutationName}(${argsText})\n}`;
  } catch {
    return `${mutationName}(${argsJson})`;
  }
}

export default function PantryCommandBar({ onChanged }: PantryCommandBarProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<ParsedCommand | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  function toggleExpanded(i: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function reset() {
    setInput("");
    setResult(null);
    setError(null);
    setExpanded(new Set());
    setStatus("idle");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  // Grows the box to fit what's typed - stays single-line at rest, expands
  // as text wraps instead of scrolling horizontally inside a fixed box.
  function handleInputChange(e: ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${e.target.scrollHeight}px`;
  }

  // Enter submits like a chat/command input; Shift+Enter still inserts a
  // literal newline for a genuinely multi-line command.
  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;

    setStatus("thinking");
    setError(null);
    setResult(null);
    setExpanded(new Set());

    try {
      const data = await runPantryQuery<ParseCommandResult>(PARSE_COMMAND_QUERY, { input: trimmed });
      setResult(data.parseCommand);
      setStatus("idle");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  async function handleConfirm() {
    if (!result?.actions?.length) return;
    setStatus("confirming");

    const failures: string[] = [];
    for (const action of result.actions) {
      const mutation = PANTRY_ACTION_MUTATIONS[action.mutationName];
      if (!mutation) {
        failures.push(`Unknown action "${action.mutationName}" - skipped.`);
        continue;
      }
      try {
        const variables = JSON.parse(action.argsJson) as Record<string, unknown>;
        await runPantryQuery(mutation, variables);
      } catch (err) {
        failures.push(`${action.summary}: ${err instanceof Error ? err.message : "failed"}`);
      }
    }

    onChanged();

    if (failures.length) {
      setStatus("error");
      setError(failures.join(" "));
      setResult(null);
    } else {
      reset();
    }
  }

  const busy = status === "thinking" || status === "confirming";

  return (
    <section className="pantry-panel pantry-command-bar">
      <h2 className="pantry-panel-title">Ask or tell it what to do</h2>

      <form onSubmit={handleSubmit} className="pantry-command-form">
        <textarea
          ref={textareaRef}
          className="form-input pantry-command-input"
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder='"Add 2L milk to the fridge" or "what&apos;s expiring soon?"'
          disabled={busy}
          maxLength={200}
          rows={1}
        />
        <button className="run-btn" type="submit" disabled={busy || !input.trim()}>
          {status === "thinking" ? "Thinking…" : "Ask"}
        </button>
      </form>

      {error && <p className="status-line">// {error}</p>}

      {result?.answer && <p className="pantry-command-answer">{result.answer}</p>}

      {result?.message && !result.answer && !result.actions && (
        <p className="status-line">// {result.message}</p>
      )}

      {result?.actions && result.actions.length > 0 && (
        <div className="pantry-command-actions">
          {result.message && <p className="status-line">// {result.message}</p>}
          {result.actions.map((action, i) => (
            <div className="pantry-command-action" key={i}>
              <div className="pantry-command-action-row">
                <p className="pantry-command-action-summary">{action.summary}</p>
                <button
                  type="button"
                  className="pantry-details-toggle"
                  onClick={() => toggleExpanded(i)}
                >
                  {expanded.has(i) ? "− hide mutation" : "+ view mutation"}
                </button>
              </div>
              {expanded.has(i) && (
                <pre className="pantry-command-mutation">
                  {formatMutationPreview(action.mutationName, action.argsJson)}
                </pre>
              )}
            </div>
          ))}
          <div className="pantry-modal-actions">
            <button type="button" className="pantry-details-toggle" onClick={reset} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="run-btn" onClick={handleConfirm} disabled={busy}>
              {status === "confirming" ? "Applying…" : "Confirm"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
