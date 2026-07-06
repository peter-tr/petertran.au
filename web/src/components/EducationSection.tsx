import Section from "./Section";
import { formatRange } from "../lib/format";
import type { Education, Program } from "../lib/types";

export default function EducationSection({
  education,
  programs,
}: {
  education: Education[];
  programs: Program[];
}) {
  return (
    <Section id="education" typeName="Education">
      {education.map((e) => (
        <div className="fact" key={e.institution}>
          <div className="role-top">
            <span className="fact-title">{e.institution}</span>
            <span className="fact-dates">{formatRange(e.startDate, e.endDate)}</span>
          </div>
          <p className="fact-sub">{e.degree}</p>
          <p className="fact-sub">{e.honors}</p>
        </div>
      ))}
      {programs.map((p) => (
        <div className="fact" key={p.name}>
          <div className="role-top">
            <span className="fact-title">{p.name}</span>
            <span className="fact-dates">{formatRange(p.startDate, p.endDate)}</span>
          </div>
          <p className="fact-sub">{p.description}</p>
        </div>
      ))}
    </Section>
  );
}
