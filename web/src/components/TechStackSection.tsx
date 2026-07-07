import type { IconType } from "react-icons";
import { FaAws } from "react-icons/fa6";
import {
  SiAnthropic,
  SiApollographql,
  SiGithubactions,
  SiNodedotjs,
  SiReact,
  SiTypescript,
  SiVite,
} from "react-icons/si";
import Section from "./Section";

interface Tech {
  name: string;
  icon: IconType;
}

const STACK: Tech[] = [
  { name: "React", icon: SiReact },
  { name: "TypeScript", icon: SiTypescript },
  { name: "Vite", icon: SiVite },
  { name: "Apollo GraphQL", icon: SiApollographql },
  { name: "Node.js", icon: SiNodedotjs },
  { name: "AWS", icon: FaAws },
  { name: "Anthropic Claude", icon: SiAnthropic },
  { name: "GitHub Actions", icon: SiGithubactions },
];

export default function TechStackSection() {
  return (
    <Section id="stack" typeName="Stack">
      <div className="stack-logos">
        {STACK.map(({ name, icon: Icon }) => (
          <span className="stack-logo" key={name}>
            <Icon size={18} />
            {name}
          </span>
        ))}
      </div>
    </Section>
  );
}
