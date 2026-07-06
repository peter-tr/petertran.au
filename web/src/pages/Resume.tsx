import ExperienceSection from "../components/ExperienceSection";
import ProjectsSection from "../components/ProjectsSection";
import SkillsSection from "../components/SkillsSection";
import EducationSection from "../components/EducationSection";
import Footer from "../components/Footer";
import type { ResumeData } from "../lib/types";

interface ResumeProps {
  data: ResumeData | null;
  error: string | null;
}

export default function Resume({ data, error }: ResumeProps) {
  return (
    <>
      <header className="page-head">
        <p className="eyebrow">full work history &amp; skills</p>
        <h1>Resume</h1>
        <div className="hero-links">
          <a href="/peter-tran-resume.pdf" target="_blank" rel="noreferrer">
            Download PDF
          </a>
        </div>
      </header>

      {error && (
        <p className="status-line">// couldn&apos;t load resume data from the API right now ({error}).</p>
      )}

      {data && (
        <>
          <ExperienceSection experience={data.experience} />
          <ProjectsSection projects={data.projects} />
          <SkillsSection skills={data.skills} />
          <EducationSection education={data.education} programs={data.programs} />
        </>
      )}

      <Footer email={data?.person.email} />
    </>
  );
}
