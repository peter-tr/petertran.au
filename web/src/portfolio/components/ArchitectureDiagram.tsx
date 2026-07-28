import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { FaAws, FaCarrot, FaDisplay, FaGlobe, FaMasksTheater, FaPalette } from "react-icons/fa6";
import { SiAnthropic, SiApollographql, SiGithubactions, SiTypescript } from "react-icons/si";

function NodeIcon({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <g transform={`translate(${x}, ${y})`} className="arch-node-icon">
      {children}
    </g>
  );
}

// A sibling project isn't part of this page's own request flow - the
// Supergraph Gateway doesn't actually federate their subgraphs in, it's just
// the closest "this is the front door to the other stuff I built" node to
// point from - so these render greyed-out (arch-node-external) and link out
// to that project's own page instead of describing a call this page makes.
function ExternalProjectNode({
  to,
  x,
  y,
  width,
  height,
  icon,
  label,
  path,
}: {
  to: string;
  x: number;
  y: number;
  width: number;
  height: number;
  icon: ReactNode;
  label: string;
  path: string;
}) {
  const centerX = x + width / 2;
  const centerY = y + height / 2;

  return (
    <Fragment>
      <Link to={to} className="arch-link" aria-label={`Open ${label} (${path})`}>
        <rect x={x} y={y} width={width} height={height} rx="8" className="arch-node arch-node-external" />
        <NodeIcon x={x + 12} y={y + 10}>
          {icon}
        </NodeIcon>
        <text x={centerX} y={centerY - 5} className="arch-node-label">
          {label}
        </text>
        <text x={centerX} y={centerY + 13} className="arch-node-sublabel">
          {path}
        </text>
      </Link>
      {/* dangling stub, arrowhead pointing at nothing - each of these has its
          own Lambda/database/etc. behind it that this diagram doesn't draw */}
      <line
        x1={x + width}
        y1={centerY}
        x2={x + width + 35}
        y2={centerY}
        className="arch-edge arch-edge-secondary"
        markerEnd="url(#arrow-muted)"
      />
    </Fragment>
  );
}

export default function ArchitectureDiagram() {
  return (
    <svg
      className="arch-diagram"
      viewBox="0 0 1170 670"
      role="img"
      aria-label="Architecture diagram: the browser is the entry point everything else flows from. It queries Route 53 (delegated from CrazyDomains) before loading the static site from CloudFront and S3, sending GraphQL requests to API Gateway at api.petertran.au, and sending performance and error telemetry to CloudWatch RUM. API Gateway routes GraphQL requests to an Apollo Federation Supergraph gateway Lambda, which fetches the portfolio subgraph over HTTPS back through the same API Gateway to the Portfolio Lambda. The Portfolio Lambda reads and writes resume data, rate limits, and usage stats in DynamoDB, fetches two API keys from Secrets Manager (one for Anthropic messages, one for Anthropic cost/usage reporting) to call the Anthropic API (Claude Haiku), sends contact-form emails via SES (verified through DNS records in the same Route 53 zone), and reports metrics, traces, and cost data to CloudWatch and X-Ray. The Supergraph Gateway also points, greyed out since they aren't actually federated into this page, to three separately deployed sibling projects - Design Studio, Pantry, and Imposter; each is clickable, opening that project's own page, and each has a dangling arrow pointing off to nothing, standing in for its own further infrastructure (Lambda, database, etc.) that this diagram doesn't draw. AWS CDK provisions all of it, deployed by GitHub Actions."
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
        <marker
          id="arrow-muted"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" className="arch-arrowhead-muted" />
        </marker>
      </defs>

      {/* connectors: DNS row */}
      <line
        x1="210"
        y1="40"
        x2="320"
        y2="40"
        className="arch-edge arch-edge-dashed"
        markerEnd="url(#arrow)"
      />
      <line
        x1="570"
        y1="40"
        x2="470"
        y2="40"
        className="arch-edge arch-edge-dashed"
        markerEnd="url(#arrow)"
      />
      <text x="222" y="32" className="arch-edge-label">
        NS delegation
      </text>
      <text x="480" y="32" className="arch-edge-label">
        DNS lookup
      </text>

      {/* connector: Browser -> CloudWatch RUM (client-side telemetry, no API
          Gateway/Lambda in the path - a browser-direct AWS call, so it's
          drawn separately from the GraphQL/static-asset edges below) */}
      <line
        x1="750"
        y1="40"
        x2="870"
        y2="40"
        className="arch-edge arch-edge-secondary"
        markerEnd="url(#arrow-muted)"
      />
      <text x="762" y="32" className="arch-edge-label">
        telemetry
      </text>

      {/* connectors: browser down to CloudFront / API Gateway */}
      <line x1="610" y1="60" x2="135" y2="110" className="arch-edge" markerEnd="url(#arrow)" />
      <line
        x1="700"
        y1="60"
        x2="610"
        y2="110"
        className="arch-edge arch-edge-dashed"
        markerEnd="url(#arrow)"
      />
      <text x="270" y="90" className="arch-edge-label">
        HTTPS
      </text>
      <text x="620" y="98" className="arch-edge-label">
        GraphQL request
      </text>

      {/* connectors: CloudFront to S3 */}
      <line x1="135" y1="170" x2="115" y2="200" className="arch-edge" markerEnd="url(#arrow)" />
      <text x="125" y="188" className="arch-edge-label">
        origin
      </text>

      {/* connectors: API Gateway to Supergraph Gateway to Portfolio Lambda */}
      <line x1="610" y1="170" x2="610" y2="200" className="arch-edge" markerEnd="url(#arrow)" />
      <text x="625" y="188" className="arch-edge-label">
        routes /graphql
      </text>
      <line x1="610" y1="260" x2="590" y2="290" className="arch-edge" markerEnd="url(#arrow)" />
      <text x="585" y="278" className="arch-edge-label">
        HTTPS subgraph fetch
      </text>

      {/* connectors: Supergraph Gateway fanning out to the 3 sibling
          projects - dashed and muted to match the greyed-out nodes, since
          this is "also built, click through" rather than a real federated
          subgraph fetch like the edge above. */}
      <line
        x1="750"
        y1="213"
        x2="870"
        y2="140"
        className="arch-edge arch-edge-secondary"
        markerEnd="url(#arrow-muted)"
      />
      <line
        x1="750"
        y1="230"
        x2="870"
        y2="230"
        className="arch-edge arch-edge-secondary"
        markerEnd="url(#arrow-muted)"
      />
      <line
        x1="750"
        y1="247"
        x2="870"
        y2="320"
        className="arch-edge arch-edge-secondary"
        markerEnd="url(#arrow-muted)"
      />
      {/* connectors: Portfolio Lambda fanning out to its 5 dependencies */}
      <line x1="400" y1="350" x2="110" y2="380" className="arch-edge" markerEnd="url(#arrow)" />
      <line x1="470" y1="350" x2="335" y2="380" className="arch-edge" markerEnd="url(#arrow)" />
      <line x1="590" y1="350" x2="575" y2="380" className="arch-edge" markerEnd="url(#arrow)" />
      <line x1="700" y1="350" x2="775" y2="380" className="arch-edge" markerEnd="url(#arrow)" />
      <line x1="780" y1="350" x2="1010" y2="380" className="arch-edge" markerEnd="url(#arrow)" />
      <text x="65" y="370" className="arch-edge-label">
        read/write
      </text>
      <text x="360" y="370" className="arch-edge-label">
        fetch keys
      </text>
      <text x="600" y="370" className="arch-edge-label">
        Claude Haiku
      </text>
      <text x="735" y="370" className="arch-edge-label">
        send email
      </text>
      <text x="895" y="370" className="arch-edge-label">
        metrics + traces + cost
      </text>

      {/* connectors: provisioning + deploy */}
      <line x1="585" y1="510" x2="585" y2="440" className="arch-edge" markerEnd="url(#arrow)" />
      <line x1="585" y1="590" x2="585" y2="560" className="arch-edge" markerEnd="url(#arrow)" />
      <text x="600" y="475" className="arch-edge-label">
        provisions everything above
      </text>
      <text x="600" y="578" className="arch-edge-label">
        deploy on push
      </text>

      {/* CrazyDomains (registrar) */}
      <g>
        <rect x="20" y="20" width="190" height="40" rx="8" className="arch-node arch-node-infra" />
        <NodeIcon x={32} y={32}>
          <FaGlobe size={16} />
        </NodeIcon>
        <text x="115" y="45" className="arch-node-label">
          CrazyDomains
        </text>
      </g>

      {/* Route 53 */}
      <g>
        <rect x="320" y="20" width="150" height="40" rx="8" className="arch-node arch-node-edge" />
        <NodeIcon x={332} y={32}>
          <FaAws size={16} />
        </NodeIcon>
        <text x="395" y="45" className="arch-node-label">
          Route 53
        </text>
      </g>

      {/* Browser - the one node everything else in this diagram flows from,
          so it gets its own callout + glow + pulsing dot rather than just
          blending in with the other edge-tier boxes. */}
      <text x="660" y="12" className="arch-entry-callout">
        ▾ you start here
      </text>
      <g>
        <rect
          x="570"
          y="20"
          width="180"
          height="40"
          rx="8"
          className="arch-node arch-node-edge arch-node-entry"
        />
        <circle cx="742" cy="28" r="4" className="arch-entry-dot" />
        <NodeIcon x={582} y={32}>
          <FaDisplay size={16} />
        </NodeIcon>
        <text x="660" y="45" className="arch-node-label">
          Browser
        </text>
      </g>

      {/* CloudWatch RUM - the one edge the browser makes directly to AWS,
          bypassing API Gateway/Lambda entirely; not shown before this. */}
      <g>
        <rect x="870" y="20" width="280" height="40" rx="8" className="arch-node arch-node-infra" />
        <NodeIcon x={882} y={32}>
          <FaAws size={16} />
        </NodeIcon>
        <text x="1010" y="45" className="arch-node-label">
          CloudWatch RUM
        </text>
      </g>

      {/* caption for the sibling-project cluster below - sits in the gap
          between RUM and Design Studio since neither node needs the space */}
      <text x="880" y="94" className="arch-edge-label">
        click to open
      </text>

      {/* CloudFront */}
      <g>
        <rect x="20" y="110" width="230" height="60" rx="8" className="arch-node arch-node-edge" />
        <NodeIcon x={32} y={120}>
          <FaAws size={16} />
        </NodeIcon>
        <text x="135" y="135" className="arch-node-label">
          CloudFront
        </text>
        <text x="135" y="153" className="arch-node-sublabel">
          CDN + TLS
        </text>
      </g>

      {/* API Gateway */}
      <g>
        <rect x="470" y="110" width="280" height="60" rx="8" className="arch-node arch-node-edge" />
        <NodeIcon x={482} y={120}>
          <FaAws size={16} />
        </NodeIcon>
        <text x="610" y="135" className="arch-node-label">
          API Gateway
        </text>
        <text x="610" y="153" className="arch-node-sublabel">
          api.petertran.au
        </text>
      </g>

      <ExternalProjectNode
        to="/design-studio"
        x={870}
        y={110}
        width={230}
        height={60}
        icon={<FaPalette size={16} />}
        label="Design Studio"
        path="/design-studio"
      />

      {/* S3 */}
      <g>
        <rect x="20" y="200" width="190" height="60" rx="8" className="arch-node arch-node-storage" />
        <NodeIcon x={32} y={210}>
          <FaAws size={16} />
        </NodeIcon>
        <text x="115" y="225" className="arch-node-label">
          S3
        </text>
        <text x="115" y="243" className="arch-node-sublabel">
          static build
        </text>
      </g>

      {/* Supergraph Gateway */}
      <g>
        <rect x="470" y="200" width="280" height="60" rx="8" className="arch-node arch-node-compute" />
        <NodeIcon x={482} y={210}>
          <SiApollographql size={16} />
        </NodeIcon>
        <text x="610" y="225" className="arch-node-label">
          Supergraph Gateway
        </text>
        <text x="610" y="243" className="arch-node-sublabel">
          Apollo Federation
        </text>
      </g>

      <ExternalProjectNode
        to="/pantry"
        x={870}
        y={200}
        width={230}
        height={60}
        icon={<FaCarrot size={16} />}
        label="Pantry"
        path="/pantry"
      />

      {/* Portfolio Lambda */}
      <g>
        <rect x="350" y="290" width="480" height="60" rx="8" className="arch-node arch-node-compute" />
        <NodeIcon x={362} y={300}>
          <FaAws size={16} />
        </NodeIcon>
        <text x="590" y="315" className="arch-node-label">
          Portfolio Lambda
        </text>
        <text x="590" y="333" className="arch-node-sublabel">
          Apollo Server (GraphQL)
        </text>
      </g>

      <ExternalProjectNode
        to="/imposter"
        x={870}
        y={290}
        width={230}
        height={60}
        icon={<FaMasksTheater size={16} />}
        label="Imposter"
        path="/imposter"
      />

      {/* DynamoDB */}
      <g>
        <rect x="20" y="380" width="180" height="60" rx="8" className="arch-node arch-node-storage" />
        <NodeIcon x={32} y={390}>
          <FaAws size={16} />
        </NodeIcon>
        <text x="110" y="405" className="arch-node-label">
          DynamoDB
        </text>
        <text x="110" y="423" className="arch-node-sublabel">
          data + limits + stats
        </text>
      </g>

      {/* Secrets Manager */}
      <g>
        <rect x="220" y="380" width="230" height="60" rx="8" className="arch-node arch-node-storage" />
        <NodeIcon x={232} y={390}>
          <FaAws size={16} />
        </NodeIcon>
        <text x="335" y="405" className="arch-node-label">
          Secrets Manager
        </text>
        <text x="335" y="423" className="arch-node-sublabel">
          2x Anthropic API keys
        </text>
      </g>

      {/* Anthropic API */}
      <g>
        <rect x="470" y="380" width="210" height="60" rx="8" className="arch-node arch-node-compute" />
        <NodeIcon x={482} y={390}>
          <SiAnthropic size={16} />
        </NodeIcon>
        <text x="575" y="405" className="arch-node-label">
          Anthropic API
        </text>
        <text x="575" y="423" className="arch-node-sublabel">
          Claude Haiku
        </text>
      </g>

      {/* SES */}
      <g>
        <rect x="700" y="380" width="150" height="60" rx="8" className="arch-node arch-node-compute" />
        <NodeIcon x={712} y={390}>
          <FaAws size={16} />
        </NodeIcon>
        <text x="775" y="405" className="arch-node-label">
          SES
        </text>
        <text x="775" y="423" className="arch-node-sublabel">
          contact emails
        </text>
      </g>

      {/* CloudWatch + X-Ray */}
      <g>
        <rect x="870" y="380" width="280" height="60" rx="8" className="arch-node arch-node-infra" />
        <NodeIcon x={882} y={390}>
          <FaAws size={16} />
        </NodeIcon>
        <text x="1010" y="405" className="arch-node-label">
          CloudWatch + X-Ray
        </text>
        <text x="1010" y="423" className="arch-node-sublabel">
          metrics + traces + cost
        </text>
      </g>

      {/* CDK */}
      <g>
        <rect x="10" y="510" width="1150" height="50" rx="8" className="arch-node arch-node-infra" />
        <NodeIcon x={24} y={527}>
          <FaAws size={16} />
        </NodeIcon>
        <NodeIcon x={48} y={527}>
          <SiTypescript size={16} />
        </NodeIcon>
        <text x="585" y="540" className="arch-node-label">
          AWS CDK (TypeScript)
        </text>
      </g>

      {/* GitHub Actions */}
      <g>
        <rect x="455" y="590" width="260" height="40" rx="8" className="arch-node arch-node-infra" />
        <NodeIcon x={467} y={602}>
          <SiGithubactions size={16} />
        </NodeIcon>
        <text x="585" y="615" className="arch-node-label">
          GitHub Actions
        </text>
      </g>
    </svg>
  );
}
