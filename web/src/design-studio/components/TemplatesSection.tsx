import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listTemplates, deleteTemplate, type Template } from "../api";
import type { NewDesignLocationState } from "../Editor";

interface TemplatesSectionProps {
  // Unfiltered list, fetched by Gallery.tsx as part of its combined
  // GALLERY_QUERY - populates both the category dropdown and the initial
  // (no filter) results, so this component makes no request of its own until
  // the user actually searches or filters.
  initialTemplates: Template[];
}

export default function TemplatesSection({ initialTemplates }: TemplatesSectionProps) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [results, setResults] = useState<Template[]>(initialTemplates);
  const [error, setError] = useState<string | null>(null);
  // Deleting a custom template can't just splice `results`/`initialTemplates`
  // - initialTemplates is Gallery's own prop (immutable here) and the
  // unfiltered view renders it directly (see displayedResults below), so a
  // deleted id is instead filtered out of whichever list is showing, no
  // matter which one that is. Avoids an extra network round-trip too.
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());

  const categories = useMemo(
    () =>
      [...new Set(initialTemplates.map((template) => template.category))].sort((a, b) => a.localeCompare(b)),
    [initialTemplates]
  );

  const isFiltered = Boolean(search || category);
  // No filter set (on mount, and again whenever a search/category is
  // cleared) renders initialTemplates directly rather than syncing it into
  // `results` via an effect - Gallery's combined GALLERY_QUERY already
  // fetched the unfiltered list (see api.ts), so this component only ever
  // touches the network for an actual search/filter.
  const displayedResults = (isFiltered ? results : initialTemplates).filter(
    (template) => !deletedIds.has(template.id)
  );
  const displayedError = isFiltered ? error : null;

  // Debounced so typing a search term doesn't fire a request per keystroke.
  // This used to fire unconditionally on mount too - a 3rd concurrent
  // request alongside Gallery's own load that could overflow provisioned
  // concurrency and cold-start.
  useEffect(() => {
    if (!isFiltered) return;

    const timeout = setTimeout(() => {
      listTemplates({ search: search || undefined, category: category || undefined })
        .then(setResults)
        .catch(() => setError("Couldn't load templates right now."));
    }, 250);

    return () => clearTimeout(timeout);
  }, [search, category, isFiltered]);

  // Just opens the template's elements into a fresh, unsaved editor session
  // (same "new design" flow a blank canvas gets) - no server call, so
  // nothing is actually persisted until the editor's own Save button is
  // clicked.
  function handleOpen(template: Template) {
    const state: NewDesignLocationState = {
      seedElements: template.elements,
      seedName: template.name,
      seedWidth: template.width,
      seedHeight: template.height,
    };
    navigate("/design-studio/new", { state });
  }

  async function handleDelete(template: Template) {
    const deleted = await deleteTemplate(template.id).catch(() => false);
    if (deleted) setDeletedIds((current) => new Set(current).add(template.id));
  }

  return (
    <div className="design-studio-templates">
      <h2>Templates</h2>
      <div className="design-studio-templates-filters">
        <input
          type="search"
          placeholder="Search templates…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search templates"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>

      {displayedError && <p className="status-line">// {displayedError}</p>}
      {displayedResults.length === 0 && !displayedError && (
        <p className="design-studio-empty">No templates match.</p>
      )}

      <ul className="design-studio-templates-grid">
        {displayedResults.map((template) => (
          <li key={template.id} className="design-studio-template-card">
            <div className="design-studio-template-swatches">
              {template.colors.map((color) => (
                <span key={color} className="design-studio-swatch" style={{ background: color }} />
              ))}
            </div>
            <span className="design-studio-template-name">{template.name}</span>
            <span className="design-studio-template-category">{template.category}</span>
            <div className="design-studio-template-actions">
              <button type="button" onClick={() => handleOpen(template)}>
                Use template
              </button>
              {template.isCustom && (
                <button
                  type="button"
                  className="design-studio-template-delete"
                  onClick={() => handleDelete(template)}
                  aria-label={`Delete ${template.name}`}
                >
                  ✕
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
