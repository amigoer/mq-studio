import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ConfirmProvider, ToastProvider } from "@/design/ui";
import { SettingsProvider } from "@/hooks/useSettings";
import { UpdateCheckProvider } from "@/hooks/useUpdateCheck";
import { bootstrapUIPrefs } from "@/hooks/useUIPrefs";
import { bootstrapUIScale } from "@/hooks/useUIScale";
import "./index.css";

/*
 * Applied before React mounts, from the mirrors the last session left behind,
 * so the window opens at the chosen size and motion instead of correcting
 * itself once the settings arrive from Go. The theme's own bootstrap runs
 * earlier still, from index.html.
 */
bootstrapUIScale();
bootstrapUIPrefs();

/*
 * Toasts and the confirm dialog sit outside the settings store: both report on
 * it, including on the calls that fail before it has anything to show.
 */
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ToastProvider>
      <ConfirmProvider>
        <SettingsProvider>
          <UpdateCheckProvider>
            <App />
          </UpdateCheckProvider>
        </SettingsProvider>
      </ConfirmProvider>
    </ToastProvider>
  </React.StrictMode>,
);
