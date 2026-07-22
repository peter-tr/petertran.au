import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import EditorWorkspace from "./components/EditorWorkspace";
import { getDesign, type Design, type Template } from "./api";
import { fromWireElement } from "./lib/serialization";
import { DEFAULT_FORMAT } from "./lib/formats";
import type { HistoryEvent } from "./lib/history/reducer";
import "./design-studio.css";

interface Seed {
  events: HistoryEvent[];
  name: string;
  width: number;
  height: number;
}

// Passed via navigate("/design-studio/new", { state }) when starting a
// blank design at a chosen format or opening a template from the gallery -
// seeds a fresh, unsaved editor session (elements empty for a blank
// format, or a template's own elements). No server call involved, so
// nothing is persisted until the editor's own Save button is clicked.
export interface NewDesignLocationState {
  seedElements?: Template["elements"];
  seedName: string;
  seedWidth: number;
  seedHeight: number;
}

function isNewDesignLocationState(state: unknown): state is NewDesignLocationState {
  return (
    !!state &&
    typeof state === "object" &&
    typeof (state as NewDesignLocationState).seedWidth === "number" &&
    typeof (state as NewDesignLocationState).seedHeight === "number"
  );
}

function seedFromLocationState(state: unknown): Seed {
  if (!isNewDesignLocationState(state)) {
    return {
      events: [],
      name: "Untitled design",
      width: DEFAULT_FORMAT.width,
      height: DEFAULT_FORMAT.height,
    };
  }

  return {
    name: state.seedName,
    width: state.seedWidth,
    height: state.seedHeight,
    events: (state.seedElements ?? []).map((element) => ({
      type: "add" as const,
      element: fromWireElement(element),
    })),
  };
}

export default function Editor() {
  const { designId } = useParams<{ designId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const isNew = designId === "new";

  // Purely derived from the current location - no async work involved, so
  // this is computed directly rather than mirrored into state via an effect
  // (an effect would need a synchronous setState call at its top just to
  // publish this, which is exactly what triggers cascading extra renders).
  const newSeed = useMemo(
    () => (isNew ? seedFromLocationState(location.state) : null),
    [isNew, location.state]
  );

  const [fetchedSeed, setFetchedSeed] = useState<Seed | null>(null);
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
        setFetchedSeed({
          name: design.name,
          width: design.width,
          height: design.height,
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

  // Gated on !isNew so a stale error from a previously-viewed design (e.g.
  // one that failed to load) never leaks into a fresh "new design" view.
  if (!isNew && error) {
    return (
      <div className="design-studio-editor">
        <p className="status-line">// {error}</p>
      </div>
    );
  }

  const seed = isNew ? newSeed : fetchedSeed;

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
      width={seed.width}
      height={seed.height}
      initialEvents={seed.events}
      initialName={seed.name}
      onSaved={handleSaved}
    />
  );
}
