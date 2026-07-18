import { lazy, Suspense, useEffect } from "react";
import Hero from "./components/Hero";
import ArchitectureSection from "./components/ArchitectureSection";
import SystemStatsSection from "./components/SystemStatsSection";
import ContactSection from "./components/ContactSection";
import Footer from "./components/Footer";
import { warmUp } from "../shared/warmUp";
import { PANTRY_ENDPOINT } from "../pantry/api";
import { IMPOSTER_ENDPOINT } from "../games/imposter/lib/api";
import "./portfolio.css";

// Lazy-loaded on its own, separate from the rest of Home - GraphiQL pulls in
// monaco-editor (a multi-MB chunk), which the rest of the page has no reason
// to wait on just to render Hero/Architecture/Contact/Stats/Footer.
const Explorer = lazy(() => import("./components/Explorer"));

export default function Home() {
  // Most visitors land here first, then click through to /pantry or the
  // imposter game - warm those two Lambdas in the background so they're
  // less likely to still be cold by the time that navigation happens.
  useEffect(() => {
    warmUp(PANTRY_ENDPOINT);
    warmUp(IMPOSTER_ENDPOINT);
  }, []);

  return (
    <>
      <Hero />
      <ArchitectureSection />
      <Suspense fallback={<p className="status-line">// loading query explorer…</p>}>
        <Explorer />
      </Suspense>
      <ContactSection />
      <SystemStatsSection />
      <Footer />
    </>
  );
}
