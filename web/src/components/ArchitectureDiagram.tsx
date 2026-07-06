export default function ArchitectureDiagram() {
  return (
    <svg
      className="arch-diagram"
      viewBox="0 0 980 500"
      role="img"
      aria-label="Architecture diagram: the browser loads the static site from CloudFront and S3, and talks directly to a Lambda-backed GraphQL API. The Lambda reads and writes resume data and rate-limit counters in DynamoDB, fetches an API key from Secrets Manager, and calls the Anthropic API (Claude Haiku) to generate queries. AWS CDK provisions all of it, deployed by GitHub Actions."
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
      <line x1="390" y1="60" x2="200" y2="118" className="arch-edge" markerEnd="url(#arrow)" />
      <line
        x1="450"
        y1="60"
        x2="600"
        y2="118"
        className="arch-edge arch-edge-dashed"
        markerEnd="url(#arrow)"
      />
      <line x1="180" y1="180" x2="180" y2="238" className="arch-edge" markerEnd="url(#arrow)" />
      <line x1="580" y1="180" x2="440" y2="238" className="arch-edge" markerEnd="url(#arrow)" />
      <line x1="620" y1="180" x2="620" y2="238" className="arch-edge" markerEnd="url(#arrow)" />
      <line x1="660" y1="180" x2="840" y2="238" className="arch-edge" markerEnd="url(#arrow)" />
      <line x1="510" y1="348" x2="510" y2="302" className="arch-edge" markerEnd="url(#arrow)" />
      <line x1="500" y1="428" x2="500" y2="398" className="arch-edge" markerEnd="url(#arrow)" />

      {/* labels on connectors */}
      <text x="230" y="82" className="arch-edge-label">
        HTTPS
      </text>
      <text x="452" y="98" className="arch-edge-label">
        direct GraphQL call
      </text>
      <text x="130" y="212" className="arch-edge-label">
        origin
      </text>
      <text x="430" y="212" className="arch-edge-label">
        read/write
      </text>
      <text x="628" y="212" className="arch-edge-label">
        fetch key
      </text>
      <text x="670" y="212" className="arch-edge-label">
        Claude Haiku
      </text>
      <text x="525" y="328" className="arch-edge-label">
        provisions everything above
      </text>
      <text x="515" y="418" className="arch-edge-label">
        deploy on push
      </text>

      {/* Browser */}
      <g>
        <rect x="340" y="20" width="160" height="40" rx="8" className="arch-node arch-node-edge" />
        <text x="420" y="45" className="arch-node-label">
          Browser
        </text>
      </g>

      {/* CloudFront */}
      <g>
        <rect x="100" y="120" width="160" height="60" rx="8" className="arch-node arch-node-edge" />
        <text x="180" y="145" className="arch-node-label">
          CloudFront
        </text>
        <text x="180" y="163" className="arch-node-sublabel">
          CDN + TLS
        </text>
      </g>

      {/* Lambda */}
      <g>
        <rect x="540" y="120" width="160" height="60" rx="8" className="arch-node arch-node-compute" />
        <text x="620" y="145" className="arch-node-label">
          Lambda
        </text>
        <text x="620" y="163" className="arch-node-sublabel">
          Apollo Server (GraphQL)
        </text>
      </g>

      {/* S3 */}
      <g>
        <rect x="100" y="240" width="160" height="60" rx="8" className="arch-node arch-node-storage" />
        <text x="180" y="265" className="arch-node-label">
          S3
        </text>
        <text x="180" y="283" className="arch-node-sublabel">
          static React build
        </text>
      </g>

      {/* DynamoDB */}
      <g>
        <rect x="340" y="240" width="160" height="60" rx="8" className="arch-node arch-node-storage" />
        <text x="420" y="265" className="arch-node-label">
          DynamoDB
        </text>
        <text x="420" y="283" className="arch-node-sublabel">
          resume data + rate limits
        </text>
      </g>

      {/* Secrets Manager */}
      <g>
        <rect x="540" y="240" width="160" height="60" rx="8" className="arch-node arch-node-storage" />
        <text x="620" y="265" className="arch-node-label">
          Secrets Manager
        </text>
        <text x="620" y="283" className="arch-node-sublabel">
          Anthropic API key
        </text>
      </g>

      {/* Anthropic API */}
      <g>
        <rect x="780" y="240" width="160" height="60" rx="8" className="arch-node arch-node-compute" />
        <text x="860" y="265" className="arch-node-label">
          Anthropic API
        </text>
        <text x="860" y="283" className="arch-node-sublabel">
          Claude Haiku
        </text>
      </g>

      {/* CDK */}
      <g>
        <rect x="160" y="348" width="700" height="50" rx="8" className="arch-node arch-node-infra" />
        <text x="510" y="378" className="arch-node-label">
          AWS CDK (TypeScript)
        </text>
      </g>

      {/* GitHub Actions */}
      <g>
        <rect x="330" y="428" width="340" height="40" rx="8" className="arch-node arch-node-infra" />
        <text x="500" y="453" className="arch-node-label">
          GitHub Actions
        </text>
      </g>
    </svg>
  );
}
