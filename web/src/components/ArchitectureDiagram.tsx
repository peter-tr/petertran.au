export default function ArchitectureDiagram() {
  return (
    <svg
      className="arch-diagram"
      viewBox="0 0 820 460"
      role="img"
      aria-label="Architecture diagram: the browser loads the static site from CloudFront and S3, and talks directly to a Lambda-backed GraphQL API which reads from DynamoDB. AWS CDK provisions all of it, deployed by GitHub Actions."
    >
      <defs>
        <marker
          id="arrow"
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

      {/* connectors */}
      <line x1="370" y1="60" x2="210" y2="108" className="arch-edge" markerEnd="url(#arrow)" />
      <line
        x1="450"
        y1="60"
        x2="610"
        y2="108"
        className="arch-edge arch-edge-dashed"
        markerEnd="url(#arrow)"
      />
      <line x1="200" y1="170" x2="200" y2="218" className="arch-edge" markerEnd="url(#arrow)" />
      <line x1="620" y1="170" x2="620" y2="218" className="arch-edge" markerEnd="url(#arrow)" />
      <line x1="410" y1="328" x2="410" y2="282" className="arch-edge" markerEnd="url(#arrow)" />
      <line x1="410" y1="408" x2="410" y2="382" className="arch-edge" markerEnd="url(#arrow)" />

      {/* labels on connectors */}
      <text x="240" y="80" className="arch-edge-label">
        HTTPS
      </text>
      <text x="470" y="90" className="arch-edge-label">
        direct GraphQL call
      </text>
      <text x="128" y="200" className="arch-edge-label">
        origin
      </text>
      <text x="548" y="200" className="arch-edge-label">
        read/write
      </text>
      <text x="425" y="308" className="arch-edge-label">
        provisions everything above
      </text>
      <text x="425" y="400" className="arch-edge-label">
        deploy on push
      </text>

      {/* Browser */}
      <g>
        <rect x="330" y="20" width="160" height="40" rx="8" className="arch-node arch-node-edge" />
        <text x="410" y="45" className="arch-node-label">
          Browser
        </text>
      </g>

      {/* CloudFront */}
      <g>
        <rect x="120" y="110" width="160" height="60" rx="8" className="arch-node arch-node-edge" />
        <text x="200" y="135" className="arch-node-label">
          CloudFront
        </text>
        <text x="200" y="153" className="arch-node-sublabel">
          CDN + TLS
        </text>
      </g>

      {/* Lambda */}
      <g>
        <rect x="540" y="110" width="160" height="60" rx="8" className="arch-node arch-node-compute" />
        <text x="620" y="135" className="arch-node-label">
          Lambda
        </text>
        <text x="620" y="153" className="arch-node-sublabel">
          Apollo Server (GraphQL)
        </text>
      </g>

      {/* S3 */}
      <g>
        <rect x="120" y="220" width="160" height="60" rx="8" className="arch-node arch-node-storage" />
        <text x="200" y="245" className="arch-node-label">
          S3
        </text>
        <text x="200" y="263" className="arch-node-sublabel">
          static React build
        </text>
      </g>

      {/* DynamoDB */}
      <g>
        <rect x="540" y="220" width="160" height="60" rx="8" className="arch-node arch-node-storage" />
        <text x="620" y="245" className="arch-node-label">
          DynamoDB
        </text>
        <text x="620" y="263" className="arch-node-sublabel">
          resume data
        </text>
      </g>

      {/* CDK */}
      <g>
        <rect x="250" y="330" width="320" height="50" rx="8" className="arch-node arch-node-infra" />
        <text x="410" y="360" className="arch-node-label">
          AWS CDK (TypeScript)
        </text>
      </g>

      {/* GitHub Actions */}
      <g>
        <rect x="250" y="410" width="320" height="40" rx="8" className="arch-node arch-node-infra" />
        <text x="410" y="435" className="arch-node-label">
          GitHub Actions
        </text>
      </g>
    </svg>
  );
}
