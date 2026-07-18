import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initRum } from "./shared/rum";
import { initClarity } from "./shared/clarity";
import "./styles/base.css";

initRum();
initClarity();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
