import { lazy, Suspense } from "react";
import Hero from "../components/Hero";
import ArchitectureSection from "../components/ArchitectureSection";
import SystemStatsSection from "../components/SystemStatsSection";
import ContactSection from "../components/ContactSection";
import Footer from "../components/Footer";
import type { ResumeData } from "../lib/types";

// Lazy-loaded on its own, separate from the rest of Home - GraphiQL pulls in
// monaco-editor (a multi-MB chunk), which the rest of the page has no reason
// to wait on just to render Hero/Architecture/Contact/Stats/Footer.
const Explorer = lazy(() => import("../components/Explorer"));

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
      <Suspense fallback={<p className="status-line">// loading query explorer…</p>}>
        <Explorer />
      </Suspense>
      <ContactSection />
      <SystemStatsSection />
      <Footer email={data?.person.email} />
    </>
  );
}
