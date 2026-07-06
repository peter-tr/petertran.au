import { useEffect } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import Nav from "./components/Nav";
import Home from "./pages/Home";
import Resume from "./pages/Resume";
import { useResumeData } from "./hooks/useResumeData";

function ScrollToHash() {
  const location = useLocation();

  useEffect(() => {
    if (!location.hash) return;
    const id = location.hash.slice(1);
    // Wait a tick so the target route's content has rendered before scrolling
    // -- React Router doesn't do this automatically like a full page load does.
    const raf = requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    });
    return () => cancelAnimationFrame(raf);
  }, [location.pathname, location.hash]);

  return null;
}

export default function App() {
  const { data, error } = useResumeData();

  return (
    <BrowserRouter>
      <ScrollToHash />
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
