import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, Link, useLocation } from "react-router-dom";
import Nav from "./components/Nav";
import { useResumeData } from "./hooks/useResumeData";

// Lazy-loaded per route so each one only downloads what it needs - Home
// alone pulls in GraphiQL/Monaco (several MB), which the Imposter game (and
// every other route) has no reason to fetch just to render.
const Home = lazy(() => import("./pages/Home"));
const Resume = lazy(() => import("./pages/Resume"));
const ImposterSetup = lazy(() => import("./games/imposter/Setup"));
const ImposterGame = lazy(() => import("./games/imposter/Game"));

function ScrollManager() {
  const location = useLocation();

  useEffect(() => {
    // Wait a tick so the target route's content has rendered before scrolling
    // -- React Router doesn't do this automatically like a full page load does.
    const raf = requestAnimationFrame(() => {
      if (location.hash) {
        const id = location.hash.slice(1);
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [location.pathname, location.hash]);

  return null;
}

// The Imposter game is a standalone side-project, not portfolio content -
// it gets a bare wordmark instead of the full site nav (resume/query/contact
// links) so it doesn't read as part of the resume site itself.
function AppNav() {
  const location = useLocation();

  if (location.pathname.startsWith("/imposter")) {
    return (
      <nav className="nav">
        <div className="nav-inner">
          <Link className="nav-mark" to="/">
            petertran.au
          </Link>
        </div>
      </nav>
    );
  }

  return <Nav />;
}

export default function App() {
  const { data, error } = useResumeData();

  return (
    <BrowserRouter>
      <ScrollManager />
      <AppNav />
      <main className="wrap" id="top">
        <Suspense fallback={<p className="status-line">// loading…</p>}>
          <Routes>
            <Route path="/" element={<Home data={data} error={error} />} />
            <Route path="/resume" element={<Resume data={data} error={error} />} />
            <Route path="/imposter" element={<ImposterSetup />} />
            <Route path="/imposter/:gameId" element={<ImposterGame />} />
          </Routes>
        </Suspense>
      </main>
    </BrowserRouter>
  );
}
