import { lazy, Suspense } from "react";
import Hero from "./components/Hero";
import ArchitectureSection from "./components/ArchitectureSection";
import SystemStatsSection from "./components/SystemStatsSection";
import ContactSection from "./components/ContactSection";
import Footer from "./components/Footer";
import "./portfolio.css";

// Lazy-loaded on its own, separate from the rest of Home - GraphiQL pulls in
// monaco-editor (a multi-MB chunk), which the rest of the page has no reason
// to wait on just to render Hero/Architecture/Contact/Stats/Footer.
const Explorer = lazy(() => import("./components/Explorer"));

export default function Home() {
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
