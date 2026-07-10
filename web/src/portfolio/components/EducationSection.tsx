import Section from "./Section";
import CompanyBadge from "./CompanyBadge";
import { formatRange } from "../../shared/lib/format";
import { useCollapsedKeys } from "../hooks/useCollapsedKeys";
import type { Education, Program } from "../lib/types";

export default function EducationSection({
  education,
  programs,
}: {
  education: Education[];
  programs: Program[];
}) {
  const { isCollapsed, toggle } = useCollapsedKeys();

  return (
    <Section id="education" typeName="Education">
      {education.map((e) => {
        const collapsed = isCollapsed(e.institution);
        return (
          <div className="fact" key={e.institution}>
            <button
              type="button"
              className="role-top"
              aria-expanded={!collapsed}
              onClick={() => toggle(e.institution)}
            >
              <div className="role-heading">
                <CompanyBadge company={e.institution} />
                <span className="fact-title">{e.institution}</span>
              </div>
              <span className="fact-dates">{formatRange(e.startDate, e.endDate)}</span>
            </button>
            {!collapsed && <p className="fact-sub">{e.degree}</p>}
            {!collapsed && <p className="fact-sub">{e.honors}</p>}
          </div>
        );
      })}
      {programs.map((p) => {
        const collapsed = isCollapsed(p.name);
        return (
          <div className="fact" key={p.name}>
            <button
              type="button"
              className="role-top"
              aria-expanded={!collapsed}
              onClick={() => toggle(p.name)}
            >
              <div className="role-heading">
                <CompanyBadge company={p.organization} />
                <span className="fact-title">{p.name}</span>
              </div>
              <span className="fact-dates">{formatRange(p.startDate, p.endDate)}</span>
            </button>
            {!collapsed && <p className="fact-sub">{p.description}</p>}
          </div>
        );
      })}
    </Section>
  );
}
