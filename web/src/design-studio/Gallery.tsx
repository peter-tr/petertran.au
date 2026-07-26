import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getGalleryData, listDesigns, deleteDesign, type Design, type Template } from "./api";
import TemplatesSection from "./components/TemplatesSection";
import { CANVAS_FORMATS } from "./lib/formats";
import type { NewDesignLocationState } from "./Editor";
import "./design-studio.css";

export default function Gallery() {
  const [designs, setDesigns] = useState<Design[] | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [error, setError] = useState<string | null>(null);

  // One combined request for both designs and templates - Gallery's own list
  // and TemplatesSection's initial unfiltered list used to be 2 (really 3,
  // see TemplatesSection) separate requests firing at mount, which could
  // outrun provisioned concurrency and cold-start. Deleting a design only
  // needs designs re-fetched, so that path stays on the plain listDesigns()
  // query below rather than re-running this combined one.
  useEffect(() => {
    getGalleryData()
      .then((data) => {
        setDesigns(data.designs);
        setTemplates(data.templates);
      })
      .catch(() => setError("Couldn't load your designs right now."));
  }, []);

  async function handleDelete(id: string) {
    await deleteDesign(id);
    listDesigns()
      .then(setDesigns)
      .catch(() => setError("Couldn't load your designs right now."));
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

      {designs?.length === 0 && <p className="design-studio-empty">No designs yet - create one.</p>}

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

      <TemplatesSection initialTemplates={templates} />
    </div>
  );
}
