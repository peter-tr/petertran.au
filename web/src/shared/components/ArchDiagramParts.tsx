import type { ReactNode } from "react";
import { FaAws, FaDisplay } from "react-icons/fa6";
import { SiGithubactions, SiTypescript } from "react-icons/si";

export function NodeIcon({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <g transform={`translate(${x}, ${y})`} className="arch-node-icon">
      {children}
    </g>
  );
}

// Every per-project architecture diagram (pantry, design-studio, ...) shares
// the same deploy-pipeline "chrome" - a Browser entry point, an AWS CDK
// provisioning box, a GitHub Actions deploy box, and the pair of "provisions
// everything above"/"deploy on push" connectors between them - only the
// project-specific fan-out in between differs. Pulled out here once each
// project's own diagram component started reproducing this same chrome
// byte-for-byte (see PantryArchitectureDiagram/DesignStudioArchitectureDiagram).
export function ArchArrowMarker({ id }: { id: string }) {
  return (
    <defs>
      <marker
        id={id}
        viewBox="0 0 10 10"
        refX="8"
        refY="5"
        markerWidth="7"
        markerHeight="7"
        orient="auto-start-reverse"
      >
        <path d="M0,0 L10,5 L0,10 z" className="arch-arrowhead" />
      </marker>
    </defs>
  );
}

export function BrowserNode() {
  return (
    <g>
      <rect x="500" y="20" width="170" height="40" rx="8" className="arch-node arch-node-edge" />
      <NodeIcon x={512} y={32}>
        <FaDisplay size={16} />
      </NodeIcon>
      <text x="585" y="45" className="arch-node-label">
        Browser
      </text>
    </g>
  );
}

// `arrowId` matches whichever <marker id="..."> the calling diagram's own
// <ArchArrowMarker> defined - SVG marker ids must be unique per document, so
// each diagram mints its own rather than sharing one.
export function ProvisioningEdges({ arrowId }: { arrowId: string }) {
  return (
    <>
      <line x1="585" y1="390" x2="585" y2="330" className="arch-edge" markerEnd={`url(#${arrowId})`} />
      <line x1="585" y1="470" x2="585" y2="440" className="arch-edge" markerEnd={`url(#${arrowId})`} />
      <text x="600" y="365" className="arch-edge-label">
        provisions everything above
      </text>
      <text x="600" y="460" className="arch-edge-label">
        deploy on push
      </text>
    </>
  );
}

export function CdkNode() {
  return (
    <g>
      <rect x="10" y="390" width="1150" height="50" rx="8" className="arch-node arch-node-infra" />
      <NodeIcon x={24} y={407}>
        <FaAws size={16} />
      </NodeIcon>
      <NodeIcon x={48} y={407}>
        <SiTypescript size={16} />
      </NodeIcon>
      <text x="585" y="420" className="arch-node-label">
        AWS CDK (TypeScript)
      </text>
    </g>
  );
}

export function GitHubActionsNode() {
  return (
    <g>
      <rect x="455" y="470" width="260" height="40" rx="8" className="arch-node arch-node-infra" />
      <NodeIcon x={467} y={482}>
        <SiGithubactions size={16} />
      </NodeIcon>
      <text x="585" y="495" className="arch-node-label">
        GitHub Actions
      </text>
    </g>
  );
}
