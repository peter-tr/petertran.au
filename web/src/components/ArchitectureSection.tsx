import Section from "./Section";
import ArchitectureDiagram from "./ArchitectureDiagram";

export default function ArchitectureSection() {
  return (
    <Section id="architecture" typeName="Architecture" wide>
      <p className="project-desc" style={{ marginBottom: "1rem" }}>
        This page isn't just a static resume -- it's served by the exact kind of system it describes: a
        Lambda-backed GraphQL API, deployed with AWS CDK, in front of a database of its own content.
      </p>
      <ArchitectureDiagram />
    </Section>
  );
}
