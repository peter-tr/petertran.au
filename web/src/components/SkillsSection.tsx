import Section from "./Section";
import type { SkillCategory } from "../lib/types";

export default function SkillsSection({ skills }: { skills: SkillCategory[] }) {
  return (
    <Section id="skills" typeName="SkillCategory">
      {skills.map((s) => (
        <div className="skill-row" key={s.category}>
          <span className="skill-cat">{s.category}</span>
          <div className="skill-items">
            {s.items.map((item) => (
              <span className="chip" key={item}>
                {item}
              </span>
            ))}
          </div>
        </div>
      ))}
    </Section>
  );
}
