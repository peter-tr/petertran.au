import { useState, type FormEvent } from "react";
import { useGraphiQL, useGraphiQLActions } from "@graphiql/react";
import { runQuery, GENERATE_QUERY_QUERY, type GenerateQueryResult } from "../lib/graphql";

const OPERATION_PATTERN = /(query|mutation|subscription)\s+(\w+)/;
const DEFAULT_DRAFT_NOTE =
  "I've filled in the message form below - add your details and click Run to send it.";

export default function AskAI() {
  const queryEditor = useGraphiQL((state) => state.queryEditor);
  const isFetching = useGraphiQL((state) => state.isFetching);
  const { run, setOperationName } = useGraphiQLActions();
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Tracks whether the in-flight (or just-finished) GraphQL request was one we
  // kicked off ourselves, so we only show the "running…" note for that request
  // - there's a real network round trip between run() and the response
  // landing. Cleared by comparing against the previous isFetching value during
  // render (React's documented pattern for derived state) rather than an
  // effect, since flipping state from inside an effect trips the linter.
  const [awaitingResult, setAwaitingResult] = useState(false);
  const [prevIsFetching, setPrevIsFetching] = useState(isFetching);
  if (isFetching !== prevIsFetching) {
    setPrevIsFetching(isFetching);
    if (!isFetching) setAwaitingResult(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || loading) return;

    setLoading(true);
    setError(null);
    setNote(null);

    try {
      const result = await runQuery<GenerateQueryResult>(GENERATE_QUERY_QUERY, { prompt });
      const { query, message } = result.meta.generateQuery;

      if (!query) {
        setNote(message ?? "I couldn't turn that into a query against this schema.");
        return;
      }
      if (!queryEditor) throw new Error("Editor isn't ready yet - try again in a moment.");

      // Setting the Monaco editor's value directly (not just the tab-state data)
      // is what actually updates the visible editor - GraphiQL only syncs
      // Monaco -> store on user edits, never store -> Monaco. We also have to
      // reset the operation name ourselves before running, unconditionally:
      // leaving the store's stale operationName from a previous query causes
      // "Unknown operation named X" once run() executes against this new
      // document. Claude usually names operations, but can return an
      // anonymous shorthand query (`{ ... }`) with no name at all - passing
      // null here (despite the type only declaring `string`) is how you tell
      // GraphiQL "no override," so the server auto-selects the document's one
      // operation instead of trying to match the previous tab's stale name.
      const operationMatch = OPERATION_PATTERN.exec(query);
      const operationType = operationMatch?.[1];
      setOperationName((operationMatch?.[2] ?? null) as unknown as string);
      queryEditor.setValue(query);

      if (operationType === "mutation") {
        // Never auto-send a real side-effecting mutation on the visitor's
        // behalf - draft it into the editor and let them review and click Run.
        setNote(message ?? DEFAULT_DRAFT_NOTE);
      } else {
        setAwaitingResult(true);
        run();
      }
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
      {awaitingResult && <span className="ask-ai-note">// running the generated query…</span>}
      {note && <span className="ask-ai-note">// {note}</span>}
      {error && <span className="ask-ai-error">// {error}</span>}
    </form>
  );
}
