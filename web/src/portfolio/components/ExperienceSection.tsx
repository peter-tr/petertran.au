import Section from "./Section";
import CompanyBadge from "./CompanyBadge";
import { formatRange } from "../../shared/lib/format";
import { useCollapsedKeys } from "../hooks/useCollapsedKeys";
import type { Experience } from "../lib/types";

export default function ExperienceSection({ experience }: { experience: Experience[] }) {
  const { isCollapsed, toggle } = useCollapsedKeys();

  return (
    <Section id="experience" typeName="Experience">
      {experience.map((role, i) => {
        const key = `${role.company}-${role.role}-${i}`;
        const collapsed = isCollapsed(key);
        return (
          <div className={`role ${role.isCurrent ? "current" : ""}`} key={key}>
            <button type="button" className="role-top" aria-expanded={!collapsed} onClick={() => toggle(key)}>
              <div className="role-heading">
                <CompanyBadge company={role.company} />
                <span className="role-title">
                  {role.role} <span className="role-company">— {role.company}</span>
                </span>
              </div>
              <span className="role-dates">{formatRange(role.startDate, role.endDate)}</span>
            </button>
            {!collapsed && role.summary && <p className="role-summary">{role.summary}</p>}
            {!collapsed && role.highlights.length > 0 && (
              <ul className="role-highlights">
                {role.highlights.map((h, hi) => (
                  <li key={hi}>{h}</li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </Section>
  );
}
