import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { applyTheme, getStoredTheme } from "./lib/theme";
import "./styles/global.css";

// Applied before the first paint, not inside a React effect, so a
// returning visitor with a stored light/dark choice never sees a flash
// of the other theme while React mounts (PHASE2_IMPLEMENTATION_PLAN.md
// §7.2). No stored choice yet -- leave it to global.css's own
// prefers-color-scheme fallback.
applyTheme(getStoredTheme());

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Could not find #root element to mount the app into");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
