import { FaAws } from "react-icons/fa6";
import { SiAnthropic, SiMongodb, SiGraphql } from "react-icons/si";
import {
  NodeIcon,
  ArchArrowMarker,
  BrowserNode,
  ProvisioningEdges,
  CdkNode,
  GitHubActionsNode,
} from "../../shared/components/ArchDiagramParts";

const ARROW_ID = "design-studio-arch-arrow";

// Design Studio's own backend, separate from the resume site's and from
// pantry's (see PantryArchitectureDiagram) - its own Lambda, MongoDB Atlas
// cluster, and CDK stack, per the "each side-project deploys independently"
// convention in CLAUDE.md.
export default function DesignStudioArchitectureDiagram() {
  return (
    <svg
      className="arch-diagram"
      viewBox="0 0 1170 530"
      role="img"
      aria-label="Architecture diagram: the browser calls a Lambda-backed GraphQL API directly, which fetches its MongoDB connection string and AI provider key from Secrets Manager, reads and writes designs and templates in MongoDB Atlas, calls either the Anthropic API or AWS Bedrock (operator-configurable) to generate design elements from a prompt, and - only when explicitly enabled in settings - makes a read-only call to the public petertran.au supergraph to ground generation in real portfolio content. AWS CDK provisions all of it, deployed by GitHub Actions."
    >
      <ArchArrowMarker id={ARROW_ID} />

      {/* Browser down to GraphQL Lambda */}
      <line x1="585" y1="60" x2="310" y2="130" className="arch-edge" markerEnd={`url(#${ARROW_ID})`} />
      <text x="380" y="98" className="arch-edge-label">
        query / mutation
      </text>

      {/* GraphQL Lambda fanning out to its four dependencies below */}
      <line x1="290" y1="190" x2="135" y2="260" className="arch-edge" markerEnd={`url(#${ARROW_ID})`} />
      <text x="130" y="225" className="arch-edge-label">
        fetch key
      </text>
      <line x1="320" y1="190" x2="415" y2="260" className="arch-edge" markerEnd={`url(#${ARROW_ID})`} />
      <text x="325" y="225" className="arch-edge-label">
        read / write
      </text>
      <line x1="380" y1="190" x2="700" y2="260" className="arch-edge" markerEnd={`url(#${ARROW_ID})`} />
      <text x="560" y="222" className="arch-edge-label">
        generateDesignElements
      </text>
      <line x1="400" y1="190" x2="1020" y2="260" className="arch-edge" markerEnd={`url(#${ARROW_ID})`} />
      <text x="850" y="245" className="arch-edge-label">
        read-only, if enabled
      </text>

      <ProvisioningEdges arrowId={ARROW_ID} />

      <BrowserNode />

      {/* GraphQL Lambda */}
      <g>
        <rect x="185" y="130" width="250" height="60" rx="8" className="arch-node arch-node-compute" />
        <NodeIcon x={197} y={140}>
          <FaAws size={16} />
        </NodeIcon>
        <text x="310" y="155" className="arch-node-label">
          Lambda
        </text>
        <text x="310" y="173" className="arch-node-sublabel">
          Apollo Server (GraphQL)
        </text>
      </g>

      {/* Secrets Manager */}
      <g>
        <rect x="10" y="260" width="250" height="60" rx="8" className="arch-node arch-node-storage" />
        <NodeIcon x={22} y={270}>
          <FaAws size={16} />
        </NodeIcon>
        <text x="135" y="285" className="arch-node-label">
          Secrets Manager
        </text>
        <text x="135" y="303" className="arch-node-sublabel">
          Mongo URI + AI provider key
        </text>
      </g>

      {/* MongoDB Atlas */}
      <g>
        <rect x="290" y="260" width="250" height="60" rx="8" className="arch-node arch-node-storage" />
        <NodeIcon x={302} y={270}>
          <SiMongodb size={16} />
        </NodeIcon>
        <text x="415" y="285" className="arch-node-label">
          MongoDB Atlas
        </text>
        <text x="415" y="303" className="arch-node-sublabel">
          designs + templates
        </text>
      </g>

      {/* Anthropic API / AWS Bedrock */}
      <g>
        <rect x="570" y="260" width="260" height="60" rx="8" className="arch-node arch-node-compute" />
        <NodeIcon x={582} y={270}>
          <SiAnthropic size={16} />
        </NodeIcon>
        <text x="700" y="285" className="arch-node-label">
          Anthropic API / Bedrock
        </text>
        <text x="700" y="303" className="arch-node-sublabel">
          operator-configurable
        </text>
      </g>

      {/* Public supergraph (portfolio subgraph, read-only) */}
      <g>
        <rect x="860" y="260" width="300" height="60" rx="8" className="arch-node arch-node-edge" />
        <NodeIcon x={872} y={270}>
          <SiGraphql size={16} />
        </NodeIcon>
        <text x="1010" y="285" className="arch-node-label">
          petertran.au supergraph
        </text>
        <text x="1010" y="303" className="arch-node-sublabel">
          portfolio data, read-only
        </text>
      </g>

      <CdkNode />
      <GitHubActionsNode />
    </svg>
  );
}
