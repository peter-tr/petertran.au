import Section from "./Section";
import type { Project } from "../lib/types";

export default function ProjectsSection({ projects }: { projects: Project[] }) {
  return (
    <Section id="projects" typeName="Project">
      {projects.map((project) => (
        <div className="project" key={project.name}>
          <span className="project-name">{project.name}</span>
          <div className="stack">
            {project.stack.map((s) => (
              <span className="chip" key={s}>
                {s}
              </span>
            ))}
          </div>
          <p className="project-desc">{project.description}</p>
        </div>
      ))}
    </Section>
  );
}
