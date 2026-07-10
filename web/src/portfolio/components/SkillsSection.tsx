import { FaAws } from "react-icons/fa6";
import Section from "./Section";
import type { SkillCategory } from "../lib/types";

// Certifications get a real link + icon (and a visually distinct chip) since
// unlike a plain skill, they're independently verifiable - the rest of the
// site's ethos is "real data, not mocked," and a certification you can't
// click through to verify undercuts that.
const CERT_LINKS: Record<string, { url: string; Icon: typeof FaAws }> = {
  "AWS Certified Developer - Associate": {
    url: "https://www.credly.com/badges/cc80a5ea-4069-4923-84ae-fb4144ceea92/",
    Icon: FaAws,
  },
};

export default function SkillsSection({ skills }: { skills: SkillCategory[] }) {
  return (
    <Section id="skills" typeName="SkillCategory">
      {skills.map((s) => (
        <div className="skill-row" key={s.category}>
          <span className="skill-cat">{s.category}</span>
          <div className="skill-items">
            {s.items.map((item) => {
              const cert = CERT_LINKS[item];
              if (!cert) {
                return (
                  <span className="chip" key={item}>
                    {item}
                  </span>
                );
              }
              const { Icon } = cert;
              return (
                <a key={item} className="chip chip-cert" href={cert.url} target="_blank" rel="noreferrer">
                  <Icon aria-hidden="true" />
                  {item}
                </a>
              );
            })}
          </div>
        </div>
      ))}
    </Section>
  );
}
