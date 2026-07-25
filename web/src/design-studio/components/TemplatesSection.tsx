import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listTemplates, type Template } from "../api";
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

  const categories = useMemo(
    () => [...new Set(initialTemplates.map((template) => template.category))].sort(),
    [initialTemplates]
  );

  // Debounced so typing a search term doesn't fire a request per keystroke.
  // No filter set (the state on mount, and again whenever a search/category
  // is cleared) just reuses initialTemplates instead of re-requesting the
  // same unfiltered list from the server - this used to fire unconditionally
  // on mount, a 3rd concurrent request alongside Gallery's own load that
  // could overflow provisioned concurrency and cold-start (see api.ts).
  useEffect(() => {
    if (!search && !category) {
      setResults(initialTemplates);
      setError(null);

      return;
    }

    const timeout = setTimeout(() => {
      listTemplates({ search: search || undefined, category: category || undefined })
        .then(setResults)
        .catch(() => setError("Couldn't load templates right now."));
    }, 250);

    return () => clearTimeout(timeout);
  }, [search, category, initialTemplates]);

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

      {error && <p className="status-line">// {error}</p>}
      {results.length === 0 && !error && <p className="design-studio-empty">No templates match.</p>}

      <ul className="design-studio-templates-grid">
        {results.map((template) => (
          <li key={template.id} className="design-studio-template-card">
            <div className="design-studio-template-swatches">
              {template.colors.map((color) => (
                <span key={color} className="design-studio-swatch" style={{ background: color }} />
              ))}
            </div>
            <span className="design-studio-template-name">{template.name}</span>
            <span className="design-studio-template-category">{template.category}</span>
            <button type="button" onClick={() => handleOpen(template)}>
              Use template
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
