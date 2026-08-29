import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { bootstrapUIScale } from "@/hooks/useUIScale";
import "./index.css";

/*
 * The static design restoration renders on its own. The Wails providers
 * (settings / connections / capabilities / overview / alerts / update check)
 * still live under `@/hooks` and go back around the tree when the pages are
 * wired to the backend again.
 */
bootstrapUIScale();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
