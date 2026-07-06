import { BrowserRouter, Routes, Route } from "react-router-dom";
import Nav from "./components/Nav";
import Home from "./pages/Home";
import Resume from "./pages/Resume";
import { useResumeData } from "./hooks/useResumeData";

export default function App() {
  const { data, error } = useResumeData();

  return (
    <BrowserRouter>
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
