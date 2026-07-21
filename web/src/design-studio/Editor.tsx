import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import EditorWorkspace from "./components/EditorWorkspace";
import { getDesign, type Design } from "./api";
import { fromWireElement } from "./lib/serialization";
import type { HistoryEvent } from "./lib/history/reducer";
import "./design-studio.css";

interface Seed {
  events: HistoryEvent[];
  name: string;
}

export default function Editor() {
  const { designId } = useParams<{ designId: string }>();
  const navigate = useNavigate();
  const isNew = designId === "new";
  const [seed, setSeed] = useState<Seed | null>(isNew ? { events: [], name: "Untitled design" } : null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isNew || !designId) return;
    let cancelled = false;

    getDesign(designId)
      .then((design) => {
        if (cancelled) return;
        if (!design) {
          setError("That design wasn't found.");
          return;
        }
        setSeed({
          name: design.name,
          events: design.elements.map((element) => ({
            type: "add" as const,
            element: fromWireElement(element),
          })),
        });
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load that design.");
      });

    return () => {
      cancelled = true;
    };
  }, [designId, isNew]);

  function handleSaved(saved: Design) {
    if (isNew) navigate(`/design-studio/${saved.id}`, { replace: true });
  }

  if (error) {
    return (
      <div className="design-studio-editor">
        <p className="status-line">// {error}</p>
      </div>
    );
  }

  if (!seed) {
    return (
      <div className="design-studio-editor">
        <p className="status-line">// loading design…</p>
      </div>
    );
  }

  return (
    <EditorWorkspace
      key={designId}
      designId={isNew ? undefined : designId}
      initialEvents={seed.events}
      initialName={seed.name}
      onSaved={handleSaved}
    />
  );
}
