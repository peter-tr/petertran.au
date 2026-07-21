import type { ReactNode } from "react";
import { FaDisplay, FaShieldHalved, FaKey, FaLock, FaServer } from "react-icons/fa6";

function NodeIcon({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <g transform={`translate(${x}, ${y})`} className="arch-node-icon">
      {children}
    </g>
  );
}

// Runtime request flow only - matches docs/zero-trust-lab.md's own ASCII
// diagram, which likewise omits the Cognito login (covered separately in
// prose there, and in this note's own first paragraph) since that's a
// one-time setup step, not part of the per-request path this illustrates.
export default function ZeroTrustDiagram() {
  return (
    <svg
      className="arch-diagram"
      viewBox="0 0 760 230"
      role="img"
      aria-label="Diagram: the client sends an opaque bearer token to the Edge HttpApi, whose authorizer introspects it and directly invokes Internal STS to exchange it for a short-lived, audience-scoped JWT signed by KMS. The Edge HttpApi forwards that JWT to the Domain-A HttpApi, whose native JWT authorizer verifies it with zero application code before it reaches the Domain-A function."
    >
      <defs>
        <marker id="ztl-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="arch-arrowhead" />
        </marker>
      </defs>

      <line x1="110" y1="100" x2="150" y2="100" className="arch-edge" markerEnd="url(#ztl-arrow)" />
      <text x="108" y="90" className="arch-edge-label">
        opaque token
      </text>

      <line x1="240" y1="130" x2="240" y2="150" className="arch-edge arch-edge-dashed" markerEnd="url(#ztl-arrow)" />
      <text x="253" y="145" className="arch-edge-label">
        introspect +
      </text>
      <text x="253" y="160" className="arch-edge-label">
        exchange
      </text>

      <line x1="330" y1="100" x2="370" y2="100" className="arch-edge" markerEnd="url(#ztl-arrow)" />
      <text x="332" y="90" className="arch-edge-label">
        Bearer JWT
      </text>

      <line x1="560" y1="100" x2="600" y2="100" className="arch-edge" markerEnd="url(#ztl-arrow)" />
      <text x="562" y="90" className="arch-edge-label">
        verified
      </text>

      {/* Client */}
      <g>
        <rect x="10" y="70" width="100" height="60" rx="8" className="arch-node arch-node-edge" />
        <NodeIcon x={22} y={80}>
          <FaDisplay size={16} />
        </NodeIcon>
        <text x="60" y="105" className="arch-node-label">
          Client
        </text>
      </g>

      {/* Edge HttpApi */}
      <g>
        <rect x="150" y="70" width="180" height="60" rx="8" className="arch-node arch-node-edge" />
        <NodeIcon x={162} y={80}>
          <FaShieldHalved size={16} />
        </NodeIcon>
        <text x="240" y="100" className="arch-node-label">
          Edge HttpApi
        </text>
        <text x="240" y="118" className="arch-node-sublabel">
          Lambda authorizer
        </text>
      </g>

      {/* Internal STS */}
      <g>
        <rect x="170" y="150" width="140" height="50" rx="8" className="arch-node arch-node-compute" />
        <NodeIcon x={182} y={160}>
          <FaKey size={14} />
        </NodeIcon>
        <text x="240" y="180" className="arch-node-label">
          Internal STS
        </text>
        <text x="240" y="196" className="arch-node-sublabel">
          KMS-signed JWT
        </text>
      </g>

      {/* Domain-A HttpApi */}
      <g>
        <rect x="370" y="70" width="190" height="60" rx="8" className="arch-node arch-node-edge" />
        <NodeIcon x={382} y={80}>
          <FaLock size={16} />
        </NodeIcon>
        <text x="465" y="100" className="arch-node-label">
          Domain-A HttpApi
        </text>
        <text x="465" y="118" className="arch-node-sublabel">
          native JWT authorizer
        </text>
      </g>

      {/* Domain-A function */}
      <g>
        <rect x="600" y="70" width="150" height="60" rx="8" className="arch-node arch-node-compute" />
        <NodeIcon x={612} y={80}>
          <FaServer size={16} />
        </NodeIcon>
        <text x="675" y="100" className="arch-node-label">
          Domain-A
        </text>
        <text x="675" y="118" className="arch-node-sublabel">
          returns claims
        </text>
      </g>
    </svg>
  );
}
