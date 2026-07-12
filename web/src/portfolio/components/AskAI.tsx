import { useState, type FormEvent } from "react";
import { useGraphiQL, useGraphiQLActions } from "@graphiql/react";
import { runQuery, GENERATE_QUERY_QUERY, type GenerateQueryResult } from "../lib/graphql";

const OPERATION_PATTERN = /(query|mutation|subscription)\s+(\w+)/;
const DEFAULT_DRAFT_NOTE =
  "I've filled in the message form below - add your details and click Run to send it.";

// A handful of one-click prompts chosen to show off what this bar can
// actually do (real bio data, and the self-referential cost/stats query),
// so a visitor who doesn't feel like typing still sees something impressive.
const EXAMPLE_PROMPTS = [
  "What's he working on right now?",
  "What's his most impressive project?",
  "What are his strongest technical skills?",
  "How much has this website cost to run?",
];

export default function AskAI() {
  const queryEditor = useGraphiQL((state) => state.queryEditor);
  const isFetching = useGraphiQL((state) => state.isFetching);
  const { run, setOperationName, prettifyEditors } = useGraphiQLActions();
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [examplesExpanded, setExamplesExpanded] = useState(false);

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

  async function runPrompt(question: string) {
    if (loading) return;

    if (!question.trim()) {
      setError("Type a question first.");
      setNote(null);
      return;
    }

    setLoading(true);
    setError(null);
    setNote(null);
    setAnswer(null);

    try {
      const result = await runQuery<GenerateQueryResult>(GENERATE_QUERY_QUERY, { prompt: question });
      const { query, message, answer: reply } = result.meta.generateQuery;

      if (!query) {
        setNote(message ?? "I couldn't turn that into a query against this schema.");
        return;
      }
      if (!queryEditor) throw new Error("Editor isn't ready yet - try again in a moment.");
      setAnswer(reply);

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
      // Claude sometimes returns a valid but single-line/minified query -
      // reformat it in place so the editor always shows readable, indented GraphQL.
      await prettifyEditors();

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
    <form
      className="ask-ai"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void runPrompt(prompt);
      }}
    >
      <input
        className="ask-ai-input"
        value={prompt}
        onChange={(e) => {
          setPrompt(e.target.value);
          if (error) setError(null);
        }}
        placeholder="Ask in plain English, e.g. “what's he working on, and what tech does he use?”"
        maxLength={300}
      />
      <button className="run-btn" type="submit" disabled={loading}>
        {loading ? "Thinking…" : "Ask Claude ▸"}
      </button>
      <div className={`ask-ai-examples${examplesExpanded ? " ask-ai-examples-expanded" : ""}`}>
        {EXAMPLE_PROMPTS.map((example) => (
          <button
            key={example}
            type="button"
            className="ask-ai-example"
            disabled={loading}
            onClick={() => {
              setPrompt(example);
              void runPrompt(example);
            }}
          >
            {example}
          </button>
        ))}
        <button
          type="button"
          className="ask-ai-examples-toggle"
          aria-expanded={examplesExpanded}
          aria-label={examplesExpanded ? "Show fewer examples" : "Show more examples"}
          onClick={() => setExamplesExpanded((v) => !v)}
        >
          {examplesExpanded ? "‹" : "…"}
        </button>
      </div>
      {answer && <p className="ask-ai-answer">{answer}</p>}
      {awaitingResult && <span className="ask-ai-note">// running the generated query…</span>}
      {note && <span className="ask-ai-note">// {note}</span>}
      {error && <span className="ask-ai-error">// {error}</span>}
    </form>
  );
}
