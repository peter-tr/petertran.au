import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, Link, NavLink, useLocation } from "react-router-dom";
import Nav from "./portfolio/components/Nav";

// Lazy-loaded per route so each one only downloads what it needs - Home
// alone pulls in GraphiQL/Monaco (several MB), which side-projects like
// Imposter and Pantry (and every other route) have no reason to fetch just
// to render.
const Home = lazy(() => import("./portfolio/Home"));
const Resume = lazy(() => import("./portfolio/Resume"));
const Pantry = lazy(() => import("./pantry/Pantry"));
const PantrySettingsPage = lazy(() => import("./pantry/PantrySettingsPage"));
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

// Standalone side-projects, not portfolio content - each gets a shared
// switcher nav (between each other, and back to the portfolio) instead of
// the full site nav (resume/query/contact links), so they don't read as
// part of the resume site itself.
const STANDALONE_ROUTE_PREFIXES = ["/imposter", "/pantry"];

function activeNavLink({ isActive }: { isActive: boolean }): string {
  return isActive ? "active" : "";
}

function AppNav() {
  const location = useLocation();
  const isStandalone = STANDALONE_ROUTE_PREFIXES.some((prefix) => location.pathname.startsWith(prefix));

  if (isStandalone) {
    return (
      <nav className="nav">
        <div className="nav-inner">
          <Link className="nav-mark" to="/">
            petertran.au
          </Link>
          <ul className="nav-links">
            <li>
              <NavLink to="/imposter" className={activeNavLink}>
                imposter
              </NavLink>
            </li>
            <li>
              <NavLink to="/pantry" className={activeNavLink}>
                pantry
              </NavLink>
            </li>
          </ul>
        </div>
      </nav>
    );
  }

  return <Nav />;
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollManager />
      <AppNav />
      <main className="wrap" id="top">
        <Suspense fallback={<p className="status-line">// loading…</p>}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/resume" element={<Resume />} />
            <Route path="/pantry" element={<Pantry />} />
            <Route path="/pantry/settings" element={<PantrySettingsPage />} />
            <Route path="/imposter" element={<ImposterSetup />} />
            <Route path="/imposter/:gameId" element={<ImposterGame />} />
          </Routes>
        </Suspense>
      </main>
    </BrowserRouter>
  );
}
