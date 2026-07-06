import Section from "./Section";
import { formatRange } from "../lib/format";
import type { Experience } from "../lib/types";

export default function ExperienceSection({ experience }: { experience: Experience[] }) {
  return (
    <Section id="experience" typeName="Experience">
      {experience.map((role, i) => (
        <div className={`role ${role.isCurrent ? "current" : ""}`} key={`${role.company}-${role.role}-${i}`}>
          <div className="role-top">
            <span className="role-title">
              {role.role} <span className="role-company">— {role.company}</span>
            </span>
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
