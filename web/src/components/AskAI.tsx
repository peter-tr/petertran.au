import { useState, type FormEvent } from "react";
import { useGraphiQL, useGraphiQLActions } from "@graphiql/react";
import { runQuery, GENERATE_QUERY_QUERY, type GenerateQueryResult } from "../lib/graphql";

const OPERATION_NAME_PATTERN = /(?:query|mutation|subscription)\s+(\w+)/;

export default function AskAI() {
  const queryEditor = useGraphiQL((state) => state.queryEditor);
  const { run, setOperationName } = useGraphiQLActions();
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || loading) return;

    setLoading(true);
    setError(null);
    setNote(null);

    try {
      const result = await runQuery<GenerateQueryResult>(GENERATE_QUERY_QUERY, { prompt });
      const { query, message } = result.generateQuery;

      if (!query) {
        setNote(message ?? "I couldn't turn that into a query against this schema.");
        return;
      }
      if (!queryEditor) throw new Error("Editor isn't ready yet -- try again in a moment.");

      // Setting the Monaco editor's value directly (not just the tab-state data)
      // is what actually updates the visible editor -- GraphiQL only syncs
      // Monaco -> store on user edits, never store -> Monaco. We also have to
      // set the operation name ourselves before running: leaving the store's
      // stale operationName from a previous query causes "Unknown operation
      // named X" once run() executes against this new document.
      const operationMatch = OPERATION_NAME_PATTERN.exec(query);
      if (operationMatch) setOperationName(operationMatch[1]);
      queryEditor.setValue(query);
      run();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="ask-ai" onSubmit={handleSubmit}>
      <input
        className="ask-ai-input"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Ask in plain English, e.g. “what's he working on, and what tech does he use?”"
        maxLength={300}
      />
      <button className="run-btn" type="submit" disabled={loading}>
        {loading ? "Thinking…" : "Ask Claude ▸"}
      </button>
      {note && <span className="ask-ai-note">// {note}</span>}
      {error && <span className="ask-ai-error">// {error}</span>}
    </form>
  );
}
