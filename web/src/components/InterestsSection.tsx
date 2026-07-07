import Section from "./Section";
import type { Interests } from "../lib/types";

export default function InterestsSection({ interests }: { interests: Interests }) {
  return (
    <Section id="interests" typeName="Interests">
      <div className="skill-row">
        <span className="skill-cat">Hobbies</span>
        <div className="skill-items">
          {interests.hobbies.map((hobby) => (
            <span className="chip" key={hobby}>
              {hobby}
            </span>
          ))}
        </div>
      </div>
      <div className="skill-row">
        <span className="skill-cat">Favorite foods</span>
        <div className="skill-items">
          {interests.favoriteFoods.map((food) => (
            <span className="chip" key={food}>
              {food}
            </span>
          ))}
        </div>
      </div>
    </Section>
  );
}
