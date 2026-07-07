import Section from "./Section";
import type { Personal } from "../lib/types";

export default function PersonalSection({ personal }: { personal: Personal }) {
  return (
    <Section id="personal" typeName="Personal">
      <div className="skill-row">
        <span className="skill-cat">Hobbies</span>
        <div className="skill-items">
          {personal.hobbies.map((hobby) => (
            <span className="chip" key={hobby}>
              {hobby}
            </span>
          ))}
        </div>
      </div>
    </Section>
  );
}
