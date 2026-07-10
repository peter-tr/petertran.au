import Section from "./Section";
import CompanyBadge from "./CompanyBadge";
import { formatRange } from "../../shared/lib/format";
import type { Experience } from "../lib/types";

export default function ExperienceSection({ experience }: { experience: Experience[] }) {
  return (
    <Section id="experience" typeName="Experience">
      {experience.map((role, i) => (
        <div className={`role ${role.isCurrent ? "current" : ""}`} key={`${role.company}-${role.role}-${i}`}>
          <div className="role-top">
            <div className="role-heading">
              <CompanyBadge company={role.company} />
              <span className="role-title">
                {role.role} <span className="role-company">— {role.company}</span>
              </span>
            </div>
            <span className="role-dates">{formatRange(role.startDate, role.endDate)}</span>
          </div>
          {role.summary && <p className="role-summary">{role.summary}</p>}
          {role.highlights.length > 0 && (
            <ul className="role-highlights">
              {role.highlights.map((h, hi) => (
                <li key={hi}>{h}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </Section>
  );
}
