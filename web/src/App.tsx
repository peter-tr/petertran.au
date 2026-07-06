import { useEffect } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import Nav from "./components/Nav";
import Home from "./pages/Home";
import Resume from "./pages/Resume";
import { useResumeData } from "./hooks/useResumeData";

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

export default function App() {
  const { data, error } = useResumeData();

  return (
    <BrowserRouter>
      <ScrollManager />
      <Nav />
      <main className="wrap" id="top">
        <Routes>
          <Route path="/" element={<Home data={data} error={error} />} />
          <Route path="/resume" element={<Resume data={data} error={error} />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
