import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getGalleryData, listDesigns, deleteDesign, type Design, type Template } from "./api";
import TemplatesSection from "./components/TemplatesSection";
import { CANVAS_FORMATS, CUSTOM_SIZE_MIN, CUSTOM_SIZE_MAX } from "./lib/formats";
import { formatEditedAgo } from "./lib/timeAgo";
import type { NewDesignLocationState } from "./Editor";
import Footer from "../shared/components/Footer";
import "./design-studio.css";

export default function Gallery() {
  const navigate = useNavigate();
  const [designs, setDesigns] = useState<Design[] | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customWidth, setCustomWidth] = useState(900);
  const [customHeight, setCustomHeight] = useState(600);

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

  function handleCreateCustom() {
    const state: NewDesignLocationState = {
      seedName: "Untitled design",
      seedWidth: customWidth,
      seedHeight: customHeight,
    };
    navigate("/design-studio/new", { state });
  }

  return (
    <div className="design-studio-gallery">
      <header className="design-studio-gallery-head">
        <h1>
          <span>Design Studio</span>
          <button
            type="button"
            className="design-studio-info-btn"
            onClick={() => setShowAbout((v) => !v)}
            aria-label="What is this page?"
            aria-expanded={showAbout}
          >
            i
          </button>
          <button
            type="button"
            className="design-studio-info-btn"
            onClick={() => setShowHelp((v) => !v)}
            aria-label="How do I use this?"
            aria-expanded={showHelp}
          >
            h
          </button>
        </h1>
        <Link
          to="/design-studio/settings"
          className="design-studio-settings-link"
          aria-label="Design Studio settings"
          title="Settings"
        >
          ⚙
        </Link>
      </header>

      {showAbout && (
        <p className="design-studio-about">
          A lightweight Canva clone - built to try AI-assisted design generation and to use MongoDB (rather
          than this site's usual DynamoDB) as a real datastore for something that's naturally a large, deeply
          nested document.
        </p>
      )}

      {showHelp && (
        <div className="design-studio-help">
          <p>
            Pick a shape/text tool from the toolbar under the canvas, or press its number key (1 rectangle, 2
            ellipse, 3 arrow, 4 text). Drag to move, use the handles to resize. <kbd>Delete</kbd> removes the
            selected element, <kbd>Cmd/Ctrl+Z</kbd> undoes, <kbd>Cmd/Ctrl+Shift+Z</kbd> redoes,{" "}
            <kbd>Cmd/Ctrl+S</kbd> saves, and <kbd>5</kbd> exports a PNG.
          </p>
          <p>
            "Generate with AI" opens a chat-style panel where you can describe what you want and keep refining
            the draft before accepting it onto the canvas. "Save as template" turns the current design into a
            reusable starting point under Templates below.
          </p>
        </div>
      )}

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
        <button
          type="button"
          className="design-studio-tool-btn"
          onClick={() => setShowCustomForm((v) => !v)}
          aria-expanded={showCustomForm}
        >
          New Custom…
        </button>
      </div>

      {showCustomForm && (
        <div className="design-studio-custom-size-form">
          <label>
            <span>Width</span>
            <input
              type="number"
              min={CUSTOM_SIZE_MIN}
              max={CUSTOM_SIZE_MAX}
              value={customWidth}
              onChange={(e) => setCustomWidth(Number(e.target.value))}
              aria-label="Custom width"
            />
          </label>
          <label>
            <span>Height</span>
            <input
              type="number"
              min={CUSTOM_SIZE_MIN}
              max={CUSTOM_SIZE_MAX}
              value={customHeight}
              onChange={(e) => setCustomHeight(Number(e.target.value))}
              aria-label="Custom height"
            />
          </label>
          <button type="button" onClick={handleCreateCustom}>
            Create
          </button>
        </div>
      )}

      {error && <p className="status-line">// {error}</p>}

      <h2 className="design-studio-section-heading">Your designs</h2>

      {designs?.length === 0 && <p className="design-studio-empty">No designs yet - create one.</p>}

      <ul className="design-studio-gallery-grid">
        {designs?.map((design) => (
          <li key={design.id} className="design-studio-gallery-card">
            <div className="design-studio-gallery-card-info">
              <Link to={`/design-studio/${design.id}`}>{design.name}</Link>
              <span className="design-studio-gallery-card-meta">
                edited {formatEditedAgo(design.updatedAt)}
              </span>
            </div>
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

      <Footer />
    </div>
  );
}
