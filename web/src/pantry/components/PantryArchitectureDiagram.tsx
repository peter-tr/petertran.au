import { FaAws } from "react-icons/fa6";
import { SiAnthropic } from "react-icons/si";
import {
  NodeIcon,
  ArchArrowMarker,
  BrowserNode,
  ProvisioningEdges,
  CdkNode,
  GitHubActionsNode,
} from "../../shared/components/ArchDiagramParts";

const ARROW_ID = "pantry-arch-arrow";

// Pantry's own backend, separate from the resume site's (see the home page's
// ArchitectureDiagram) - its own Lambda, DynamoDB table, and CDK stack, per
// the "each side-project deploys independently" convention in CLAUDE.md.
export default function PantryArchitectureDiagram() {
  return (
    <svg
      className="arch-diagram"
      viewBox="0 0 1170 530"
      role="img"
      aria-label="Architecture diagram: the browser calls a Lambda-backed GraphQL API directly, which reads and writes inventory, shopping list, and settings data in DynamoDB, fetches an API key from Secrets Manager to call the Anthropic API (Claude Haiku) for the AI command bar, and can fire-and-forget invoke a third Lambda on demand to sync prices immediately. Separately, an EventBridge Scheduler fires two independent schedules: hourly, it invokes a digest Lambda that reads settings and the shopping list from the same DynamoDB table and, only if enabled and the configured hour matches and an urgent item exists, sends a digest email via SES; daily, it invokes a price-check Lambda (worker) that reads trackPrice-flagged inventory items, calls the Anthropic API with the web_search tool to look up Coles prices, and writes the result back to DynamoDB. AWS CDK provisions all of it, deployed by GitHub Actions."
    >
      <ArchArrowMarker id={ARROW_ID} />

      {/* Browser down to GraphQL Lambda */}
      <line x1="585" y1="60" x2="295" y2="130" className="arch-edge" markerEnd={`url(#${ARROW_ID})`} />
      <text x="360" y="98" className="arch-edge-label">
        query / mutation
      </text>

      {/* GraphQL Lambda fanning out */}
      <line x1="295" y1="190" x2="100" y2="260" className="arch-edge" markerEnd={`url(#${ARROW_ID})`} />
      <line x1="295" y1="190" x2="300" y2="260" className="arch-edge" markerEnd={`url(#${ARROW_ID})`} />
      <line x1="295" y1="190" x2="495" y2="260" className="arch-edge" markerEnd={`url(#${ARROW_ID})`} />
      <text x="150" y="225" className="arch-edge-label">
        fetch key
      </text>
      <text x="320" y="225" className="arch-edge-label">
        Claude Haiku
      </text>
      <text x="440" y="225" className="arch-edge-label">
        read / write
      </text>

      {/* GraphQL Lambda -> Price Check Lambda (on-demand "sync prices now") */}
      <line x1="400" y1="190" x2="1072" y2="260" className="arch-edge" markerEnd={`url(#${ARROW_ID})`} />
      <text x="730" y="248" className="arch-edge-label">
        sync now (invoke)
      </text>

      {/* EventBridge Scheduler fanning out to both scheduled Lambdas */}
      <line x1="765" y1="190" x2="700" y2="260" className="arch-edge" markerEnd={`url(#${ARROW_ID})`} />
      <text x="710" y="225" className="arch-edge-label">
        invoke hourly
      </text>
      <line x1="820" y1="190" x2="1072" y2="260" className="arch-edge" markerEnd={`url(#${ARROW_ID})`} />
      <text x="920" y="222" className="arch-edge-label">
        invoke daily
      </text>

      {/* Digest Lambda's own two dependencies, same row - labeled below to
          avoid crowding the row-2 fan-out labels above. */}
      <line x1="605" y1="290" x2="580" y2="290" className="arch-edge" markerEnd={`url(#${ARROW_ID})`} />
      <text x="475" y="340" className="arch-edge-label">
        read settings + list
      </text>
      <line x1="795" y1="290" x2="830" y2="290" className="arch-edge" markerEnd={`url(#${ARROW_ID})`} />
      <text x="745" y="340" className="arch-edge-label">
        send digest email
      </text>

      {/* Price Check Lambda's dependencies - routed below the row (a small
          drop then fan-out, mirroring the GraphQL Lambda fan-out above) so
          the long reach back to DynamoDB/Anthropic API doesn't cut through
          the Digest Lambda / SES boxes sitting between them. */}
      <line x1="1072" y1="320" x2="1072" y2="350" className="arch-edge" />
      <line x1="1072" y1="350" x2="495" y2="320" className="arch-edge" markerEnd={`url(#${ARROW_ID})`} />
      <line x1="1072" y1="350" x2="300" y2="320" className="arch-edge" markerEnd={`url(#${ARROW_ID})`} />
      <text x="600" y="345" className="arch-edge-label">
        write lastKnownPrice
      </text>
      <text x="380" y="365" className="arch-edge-label">
        Claude Haiku + web_search
      </text>

      <ProvisioningEdges arrowId={ARROW_ID} />

      <BrowserNode />

      {/* GraphQL Lambda */}
      <g>
        <rect x="185" y="130" width="220" height="60" rx="8" className="arch-node arch-node-compute" />
        <NodeIcon x={197} y={140}>
          <FaAws size={16} />
        </NodeIcon>
        <text x="295" y="155" className="arch-node-label">
          Lambda
        </text>
        <text x="295" y="173" className="arch-node-sublabel">
          Apollo Server (GraphQL)
        </text>
      </g>

      {/* EventBridge Scheduler */}
      <g>
        <rect x="640" y="130" width="250" height="60" rx="8" className="arch-node arch-node-infra" />
        <NodeIcon x={652} y={140}>
          <FaAws size={16} />
        </NodeIcon>
        <text x="765" y="155" className="arch-node-label">
          EventBridge Scheduler
        </text>
        <text x="765" y="173" className="arch-node-sublabel">
          Australia/Sydney
        </text>
      </g>

      {/* Secrets Manager */}
      <g>
        <rect x="10" y="260" width="180" height="60" rx="8" className="arch-node arch-node-storage" />
        <NodeIcon x={22} y={270}>
          <FaAws size={16} />
        </NodeIcon>
        <text x="100" y="285" className="arch-node-label">
          Secrets Manager
        </text>
        <text x="100" y="303" className="arch-node-sublabel">
          Anthropic API key
        </text>
      </g>

      {/* Anthropic API */}
      <g>
        <rect x="215" y="260" width="170" height="60" rx="8" className="arch-node arch-node-compute" />
        <NodeIcon x={227} y={270}>
          <SiAnthropic size={16} />
        </NodeIcon>
        <text x="300" y="285" className="arch-node-label">
          Anthropic API
        </text>
        <text x="300" y="303" className="arch-node-sublabel">
          Claude Haiku
        </text>
      </g>

      {/* DynamoDB */}
      <g>
        <rect x="410" y="260" width="170" height="60" rx="8" className="arch-node arch-node-storage" />
        <NodeIcon x={422} y={270}>
          <FaAws size={16} />
        </NodeIcon>
        <text x="495" y="285" className="arch-node-label">
          DynamoDB
        </text>
        <text x="495" y="303" className="arch-node-sublabel">
          inventory + list + settings
        </text>
      </g>

      {/* Digest Lambda */}
      <g>
        <rect x="605" y="260" width="190" height="60" rx="8" className="arch-node arch-node-compute" />
        <NodeIcon x={617} y={270}>
          <FaAws size={16} />
        </NodeIcon>
        <text x="700" y="285" className="arch-node-label">
          Lambda
        </text>
        <text x="700" y="303" className="arch-node-sublabel">
          digest handler
        </text>
      </g>

      {/* SES */}
      <g>
        <rect x="830" y="260" width="130" height="60" rx="8" className="arch-node arch-node-compute" />
        <NodeIcon x={842} y={270}>
          <FaAws size={16} />
        </NodeIcon>
        <text x="895" y="285" className="arch-node-label">
          SES
        </text>
        <text x="895" y="303" className="arch-node-sublabel">
          digest email
        </text>
      </g>

      {/* Price Check Lambda - a worker: no request ever waits on it, both its
          triggers (daily schedule, on-demand sync) are fire-and-forget, and
          it writes results back to DynamoDB for the GraphQL Lambda to read
          on the next query, same as everything else in this diagram. */}
      <g>
        <rect x="985" y="260" width="175" height="60" rx="8" className="arch-node arch-node-compute" />
        <NodeIcon x={997} y={270}>
          <FaAws size={16} />
        </NodeIcon>
        <text x="1072" y="285" className="arch-node-label">
          Lambda
        </text>
        <text x="1072" y="303" className="arch-node-sublabel">
          price-check worker
        </text>
      </g>

      <CdkNode />
      <GitHubActionsNode />
    </svg>
  );
}
