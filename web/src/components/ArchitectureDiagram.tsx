import type { ReactNode } from "react";
import { FaAws, FaDisplay, FaGlobe } from "react-icons/fa6";
import { SiAnthropic, SiGithubactions, SiTypescript } from "react-icons/si";

function NodeIcon({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <g transform={`translate(${x}, ${y})`} className="arch-node-icon">
      {children}
    </g>
  );
}

export default function ArchitectureDiagram() {
  return (
    <svg
      className="arch-diagram"
      viewBox="0 0 1080 530"
      role="img"
      aria-label="Architecture diagram: CrazyDomains delegates DNS to Route 53, which the browser queries before loading the static site from CloudFront and S3, and calling a Lambda-backed GraphQL API directly. The Lambda reads and writes resume data, rate limits, and usage stats in DynamoDB, fetches an API key from Secrets Manager to call the Anthropic API (Claude Haiku), sends contact-form emails via SES (verified through DNS records in the same Route 53 zone), and reports metrics and traces to CloudWatch and X-Ray. AWS CDK provisions all of it, deployed by GitHub Actions."
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

      {/* connectors: DNS row */}
      <line
        x1="180"
        y1="40"
        x2="220"
        y2="40"
        className="arch-edge arch-edge-dashed"
        markerEnd="url(#arrow)"
      />
      <line
        x1="470"
        y1="40"
        x2="370"
        y2="40"
        className="arch-edge arch-edge-dashed"
        markerEnd="url(#arrow)"
      />
      <text x="182" y="32" className="arch-edge-label">
        NS delegation
      </text>
      <text x="390" y="32" className="arch-edge-label">
        DNS lookup
      </text>

      {/* connectors: browser down to CloudFront / Lambda */}
      <line x1="505" y1="60" x2="150" y2="130" className="arch-edge" markerEnd="url(#arrow)" />
      <line
        x1="605"
        y1="60"
        x2="555"
        y2="130"
        className="arch-edge arch-edge-dashed"
        markerEnd="url(#arrow)"
      />
      <text x="230" y="105" className="arch-edge-label">
        HTTPS
      </text>
      <text x="562" y="100" className="arch-edge-label">
        direct GraphQL call
      </text>

      {/* connectors: CloudFront to S3 */}
      <line x1="105" y1="190" x2="100" y2="260" className="arch-edge" markerEnd="url(#arrow)" />
      <text x="112" y="230" className="arch-edge-label">
        origin
      </text>

      {/* connectors: Lambda fanning out to its 5 dependencies */}
      <line x1="470" y1="190" x2="270" y2="260" className="arch-edge" markerEnd="url(#arrow)" />
      <line x1="510" y1="190" x2="440" y2="260" className="arch-edge" markerEnd="url(#arrow)" />
      <line x1="550" y1="190" x2="610" y2="260" className="arch-edge" markerEnd="url(#arrow)" />
      <line x1="590" y1="190" x2="780" y2="260" className="arch-edge" markerEnd="url(#arrow)" />
      <line x1="630" y1="190" x2="950" y2="260" className="arch-edge" markerEnd="url(#arrow)" />
      <text x="215" y="250" className="arch-edge-label">
        read/write
      </text>
      <text x="395" y="250" className="arch-edge-label">
        fetch key
      </text>
      <text x="580" y="250" className="arch-edge-label">
        Claude Haiku
      </text>
      <text x="735" y="250" className="arch-edge-label">
        send email
      </text>
      <text x="865" y="250" className="arch-edge-label">
        metrics + traces
      </text>

      {/* connectors: provisioning + deploy */}
      <line x1="530" y1="390" x2="530" y2="330" className="arch-edge" markerEnd="url(#arrow)" />
      <line x1="530" y1="470" x2="530" y2="440" className="arch-edge" markerEnd="url(#arrow)" />
      <text x="545" y="365" className="arch-edge-label">
        provisions everything above
      </text>
      <text x="545" y="460" className="arch-edge-label">
        deploy on push
      </text>

      {/* CrazyDomains (registrar) */}
      <g>
        <rect x="30" y="20" width="150" height="40" rx="8" className="arch-node arch-node-infra" />
        <NodeIcon x={42} y={32}>
          <FaGlobe size={16} />
        </NodeIcon>
        <text x="115" y="45" className="arch-node-label">
          CrazyDomains
        </text>
      </g>

      {/* Route 53 */}
      <g>
        <rect x="220" y="20" width="150" height="40" rx="8" className="arch-node arch-node-edge" />
        <NodeIcon x={232} y={32}>
          <FaAws size={16} />
        </NodeIcon>
        <text x="295" y="45" className="arch-node-label">
          Route 53
        </text>
      </g>

      {/* Browser */}
      <g>
        <rect x="470" y="20" width="170" height="40" rx="8" className="arch-node arch-node-edge" />
        <NodeIcon x={482} y={32}>
          <FaDisplay size={16} />
        </NodeIcon>
        <text x="555" y="45" className="arch-node-label">
          Browser
        </text>
      </g>

      {/* CloudFront */}
      <g>
        <rect x="30" y="130" width="150" height="60" rx="8" className="arch-node arch-node-edge" />
        <NodeIcon x={42} y={140}>
          <FaAws size={16} />
        </NodeIcon>
        <text x="105" y="155" className="arch-node-label">
          CloudFront
        </text>
        <text x="105" y="173" className="arch-node-sublabel">
          CDN + TLS
        </text>
      </g>

      {/* Lambda */}
      <g>
        <rect x="450" y="130" width="200" height="60" rx="8" className="arch-node arch-node-compute" />
        <NodeIcon x={462} y={140}>
          <FaAws size={16} />
        </NodeIcon>
        <text x="550" y="155" className="arch-node-label">
          Lambda
        </text>
        <text x="550" y="173" className="arch-node-sublabel">
          Apollo Server (GraphQL)
        </text>
      </g>

      {/* S3 */}
      <g>
        <rect x="30" y="260" width="140" height="60" rx="8" className="arch-node arch-node-storage" />
        <NodeIcon x={42} y={270}>
          <FaAws size={16} />
        </NodeIcon>
        <text x="100" y="285" className="arch-node-label">
          S3
        </text>
        <text x="100" y="303" className="arch-node-sublabel">
          static React build
        </text>
      </g>

      {/* DynamoDB */}
      <g>
        <rect x="200" y="260" width="140" height="60" rx="8" className="arch-node arch-node-storage" />
        <NodeIcon x={212} y={270}>
          <FaAws size={16} />
        </NodeIcon>
        <text x="270" y="285" className="arch-node-label">
          DynamoDB
        </text>
        <text x="270" y="303" className="arch-node-sublabel">
          data + limits + stats
        </text>
      </g>

      {/* Secrets Manager */}
      <g>
        <rect x="370" y="260" width="140" height="60" rx="8" className="arch-node arch-node-storage" />
        <NodeIcon x={382} y={270}>
          <FaAws size={16} />
        </NodeIcon>
        <text x="440" y="285" className="arch-node-label">
          Secrets Manager
        </text>
        <text x="440" y="303" className="arch-node-sublabel">
          Anthropic API key
        </text>
      </g>

      {/* Anthropic API */}
      <g>
        <rect x="540" y="260" width="140" height="60" rx="8" className="arch-node arch-node-compute" />
        <NodeIcon x={552} y={270}>
          <SiAnthropic size={16} />
        </NodeIcon>
        <text x="610" y="285" className="arch-node-label">
          Anthropic API
        </text>
        <text x="610" y="303" className="arch-node-sublabel">
          Claude Haiku
        </text>
      </g>

      {/* SES */}
      <g>
        <rect x="710" y="260" width="140" height="60" rx="8" className="arch-node arch-node-compute" />
        <NodeIcon x={722} y={270}>
          <FaAws size={16} />
        </NodeIcon>
        <text x="780" y="285" className="arch-node-label">
          SES
        </text>
        <text x="780" y="303" className="arch-node-sublabel">
          contact form emails
        </text>
      </g>

      {/* CloudWatch + X-Ray */}
      <g>
        <rect x="880" y="260" width="140" height="60" rx="8" className="arch-node arch-node-infra" />
        <NodeIcon x={892} y={270}>
          <FaAws size={16} />
        </NodeIcon>
        <text x="950" y="285" className="arch-node-label">
          CloudWatch + X-Ray
        </text>
        <text x="950" y="303" className="arch-node-sublabel">
          metrics + traces
        </text>
      </g>

      {/* CDK */}
      <g>
        <rect x="20" y="390" width="1020" height="50" rx="8" className="arch-node arch-node-infra" />
        <NodeIcon x={34} y={407}>
          <FaAws size={16} />
        </NodeIcon>
        <NodeIcon x={58} y={407}>
          <SiTypescript size={16} />
        </NodeIcon>
        <text x="530" y="420" className="arch-node-label">
          AWS CDK (TypeScript)
        </text>
      </g>

      {/* GitHub Actions */}
      <g>
        <rect x="400" y="470" width="260" height="40" rx="8" className="arch-node arch-node-infra" />
        <NodeIcon x={412} y={482}>
          <SiGithubactions size={16} />
        </NodeIcon>
        <text x="530" y="495" className="arch-node-label">
          GitHub Actions
        </text>
      </g>
    </svg>
  );
}
