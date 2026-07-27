import { Link } from "react-router-dom";
import { useDesignStudioAiSettings } from "./hooks/useDesignStudioAiSettings";
import { AiProvider, AiModelTier } from "./api";
import DesignStudioArchitectureDiagram from "./components/DesignStudioArchitectureDiagram";
import Footer from "../shared/components/Footer";
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
            <label className="form-label form-checkbox-label" htmlFor="design-studio-allow-supergraph">
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

      <section className="design-studio-panel">
        <div className="design-studio-panel-header">
          <h2 className="design-studio-panel-title">Architecture</h2>
        </div>
        <p className="project-desc" style={{ marginBottom: "1rem" }}>
          Design Studio is its own Lambda, MongoDB Atlas cluster, and CDK stack, separate from the resume site
          and from pantry (which uses DynamoDB).
        </p>
        <p className="project-desc" style={{ marginBottom: "1rem" }}>
          MongoDB over this repo&apos;s usual DynamoDB, deliberately: a design document is large, deeply
          nested, and gains new element types/properties as the editor grows - a document store absorbs that
          field by field, with no migration step, unlike a pre-planned DynamoDB GSI per query shape. That also
          happens to be the same reasoning behind Canva&apos;s own stack - their engineering team has{" "}
          <a
            href="https://www.mongodb.com/blog/post/video-canvas-lessons-scaling-mongodb-atlas-billion-documents-across-nodes"
            target="_blank"
            rel="noreferrer"
          >
            talked publicly about scaling MongoDB Atlas to 10+ billion documents
          </a>{" "}
          as the store behind every design a user opens, creates, or edits.
        </p>
        <DesignStudioArchitectureDiagram />
      </section>

      <Footer />
    </>
  );
}
