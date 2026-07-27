import { Link } from "react-router-dom";
import { useDesignStudioAiSettings } from "./hooks/useDesignStudioAiSettings";
import { AiProvider, AiModelTier } from "./api";
import "./design-studio.css";

export default function DesignStudioSettingsPage() {
  const { settings, error, updateSettings } = useDesignStudioAiSettings();

  return (
    <>
      <header className="design-studio-settings-head">
        <h1>Design Studio settings</h1>
        <Link to="/design-studio" className="design-studio-settings-back">
          ← back to gallery
        </Link>
      </header>

      {error && <p className="status-line">// couldn&apos;t load settings right now ({error}).</p>}

      {settings && (
        <section className="design-studio-panel">
          <div className="design-studio-panel-header">
            <h2 className="design-studio-panel-title">AI provider</h2>
          </div>
          <p className="project-desc">Which backend and model generateDesignElements runs on.</p>
          <div className="form-row design-studio-settings-row">
            <label className="form-label" htmlFor="design-studio-ai-provider">
              Provider
            </label>
            <select
              id="design-studio-ai-provider"
              className="form-input"
              value={settings.provider}
              onChange={(e) => {
                const provider = e.target.value as AiProvider;
                // Bedrock doesn't currently support structured output for
                // Haiku 4.5 (see generate-elements.ts) - steer off it
                // automatically, same as AiPanel's inline picker.
                if (provider === AiProvider.Bedrock && settings.modelTier === AiModelTier.Haiku) {
                  updateSettings({ provider, modelTier: AiModelTier.Sonnet });
                } else {
                  updateSettings({ provider });
                }
              }}
            >
              <option value={AiProvider.Anthropic}>Direct Anthropic API</option>
              <option value={AiProvider.Bedrock}>AWS Bedrock</option>
            </select>
          </div>
          <div className="form-row design-studio-settings-row">
            <label className="form-label" htmlFor="design-studio-ai-model-tier">
              Model
            </label>
            <select
              id="design-studio-ai-model-tier"
              className="form-input"
              value={settings.modelTier}
              onChange={(e) => updateSettings({ modelTier: e.target.value as AiModelTier })}
            >
              <option value={AiModelTier.Haiku} disabled={settings.provider === AiProvider.Bedrock}>
                Haiku 4.5 (fast)
                {settings.provider === AiProvider.Bedrock ? " - not available on Bedrock" : ""}
              </option>
              <option value={AiModelTier.Sonnet}>Sonnet 4.6 (better quality)</option>
            </select>
          </div>
        </section>
      )}

      {settings && (
        <section className="design-studio-panel">
          <div className="design-studio-panel-header">
            <h2 className="design-studio-panel-title">Portfolio data access</h2>
          </div>
          <p className="project-desc">
            When enabled, AI generation can call a read-only tool to look up real portfolio content (job
            title, projects, skills) from the public petertran.au API, to ground generated designs in real
            facts - e.g. a resume header using your actual current title. The tool can only read portfolio
            data; it can never write anything or reach pantry/imposter&apos;s own data.
          </p>
          <div className="form-row design-studio-settings-row">
            <label className="form-label" htmlFor="design-studio-allow-supergraph">
              <input
                id="design-studio-allow-supergraph"
                type="checkbox"
                checked={settings.allowSupergraphQuery}
                onChange={(e) => updateSettings({ allowSupergraphQuery: e.target.checked })}
              />{" "}
              Allow AI generation to query portfolio data
            </label>
          </div>
        </section>
      )}
    </>
  );
}
