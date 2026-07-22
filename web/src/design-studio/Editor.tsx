import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import EditorWorkspace from "./components/EditorWorkspace";
import { getDesign, type Design, type Template } from "./api";
import { fromWireElement } from "./lib/serialization";
import type { HistoryEvent } from "./lib/history/reducer";
import "./design-studio.css";

interface Seed {
  events: HistoryEvent[];
  name: string;
}

// Passed via navigate("/design-studio/new", { state }) when opening a
// template from the gallery - seeds a fresh, unsaved editor session with
// the template's elements. No server call involved, so nothing is
// persisted until the editor's own Save button is clicked.
export interface NewDesignLocationState {
  seedElements: Template["elements"];
  seedName: string;
}

function isNewDesignLocationState(state: unknown): state is NewDesignLocationState {
  return !!state && typeof state === "object" && Array.isArray((state as NewDesignLocationState).seedElements);
}

function seedFromLocationState(state: unknown): Seed {
  if (!isNewDesignLocationState(state)) return { events: [], name: "Untitled design" };

  return {
    name: state.seedName,
    events: state.seedElements.map((element) => ({ type: "add" as const, element: fromWireElement(element) })),
  };
}

export default function Editor() {
  const { designId } = useParams<{ designId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const isNew = designId === "new";
  const [seed, setSeed] = useState<Seed | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);

    // Keyed on location.key (React Router's unique id per navigation entry),
    // not just designId - opening a *different* template still lands on the
    // same "/design-studio/new" path, so designId alone wouldn't change and
    // this effect wouldn't otherwise notice the new location.state (e.g.
    // browser back to the gallery, then opening a second template).
    if (isNew) {
      setSeed(seedFromLocationState(location.state));

      return;
    }

    if (!designId) return;

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
  }, [designId, isNew, location.key, location.state]);

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
      key={isNew ? location.key : designId}
      designId={isNew ? undefined : designId}
      initialEvents={seed.events}
      initialName={seed.name}
      onSaved={handleSaved}
    />
  );
}
