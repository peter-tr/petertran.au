import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listDesigns, deleteDesign, type Design } from "./api";
import TemplatesSection from "./components/TemplatesSection";
import { CANVAS_FORMATS } from "./lib/formats";
import type { NewDesignLocationState } from "./Editor";
import "./design-studio.css";

export default function Gallery() {
  const [designs, setDesigns] = useState<Design[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refetch() {
    listDesigns()
      .then(setDesigns)
      .catch(() => setError("Couldn't load your designs right now."));
  }

  useEffect(refetch, []);

  async function handleDelete(id: string) {
    await deleteDesign(id);
    refetch();
  }

  return (
    <div className="design-studio-gallery">
      <header className="design-studio-gallery-head">
        <h1>Design Studio</h1>
        <div className="design-studio-new-formats">
          {CANVAS_FORMATS.map((format) => {
            const state: NewDesignLocationState = {
              seedName: `Untitled ${format.label.toLowerCase()}`,
              seedWidth: format.width,
              seedHeight: format.height,
            };

            return (
              <Link key={format.id} to="/design-studio/new" state={state} className="design-studio-tool-btn">
                New {format.label}
              </Link>
            );
          })}
        </div>
      </header>

      {error && <p className="status-line">// {error}</p>}

      {designs && designs.length === 0 && <p className="design-studio-empty">No designs yet - create one.</p>}

      <ul className="design-studio-gallery-grid">
        {designs?.map((design) => (
          <li key={design.id} className="design-studio-gallery-card">
            <Link to={`/design-studio/${design.id}`}>{design.name}</Link>
            <button
              type="button"
              onClick={() => handleDelete(design.id)}
              aria-label={`Delete ${design.name}`}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      <TemplatesSection />
    </div>
  );
}
