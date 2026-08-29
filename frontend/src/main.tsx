import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ConfirmProvider, Toaster } from "@/design/ui";
import { ConnectionProfilesProvider } from "@/hooks/useConnectionProfiles";
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
 * The toast stack and the confirm dialog sit outside the settings store: both
 * report on it, including on the calls that fail before it has anything to
 * show. The Toaster is a sibling rather than a wrapper -- sonner's toasts are
 * raised through a module-level queue, not through context.
 */
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfirmProvider>
      <SettingsProvider>
        <UpdateCheckProvider>
          <ConnectionProfilesProvider>
            <App />
          </ConnectionProfilesProvider>
        </UpdateCheckProvider>
      </SettingsProvider>
    </ConfirmProvider>
    <Toaster />
  </React.StrictMode>,
);
