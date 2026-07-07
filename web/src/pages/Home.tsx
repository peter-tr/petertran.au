import Hero from "../components/Hero";
import ArchitectureSection from "../components/ArchitectureSection";
import SystemStatsSection from "../components/SystemStatsSection";
import Explorer from "../components/Explorer";
import ContactSection from "../components/ContactSection";
import Footer from "../components/Footer";
import type { ResumeData } from "../lib/types";

interface HomeProps {
  data: ResumeData | null;
  error: string | null;
}

export default function Home({ data, error }: HomeProps) {
  return (
    <>
      <Hero person={data?.person ?? null} />

      {error && (
        <p className="status-line">
          // couldn&apos;t load data from the API right now ({error}). The query explorer below will retry on
          its own.
        </p>
      )}

      <ArchitectureSection />
      <Explorer />
      <ContactSection />
      <SystemStatsSection />
      <Footer email={data?.person.email} />
    </>
  );
}
