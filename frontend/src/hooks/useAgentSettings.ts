import { useCallback, useEffect, useState } from "react";
import {
  deleteAgentProvider,
  getAgentSettings,
  saveAgentPreferences,
  saveAgentProvider,
  type AgentPreferencesInput,
  type AgentProviderInput,
  type AgentSettingsView,
} from "@/api/agent";

/**
 * The assistant's set-up, read once when the settings section opens.
 *
 * Only this page writes it, so there is no event to follow: every change
 * comes back from Go as the whole set-up after the write, and replaces the
 * copy here.
 */
export function useAgentSettings() {
  const [view, setView] = useState<AgentSettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAgentSettings()
      .then((loaded) => {
        if (!cancelled) setView(loaded);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const apply = useCallback((pending: Promise<AgentSettingsView>) => pending.then((next) => {
    setView(next);
    return next;
  }), []);

  return {
    view,
    error,
    saveProvider: useCallback((input: AgentProviderInput) => apply(saveAgentProvider(input)), [apply]),
    deleteProvider: useCallback((id: string) => apply(deleteAgentProvider(id)), [apply]),
    savePreferences: useCallback(
      (input: AgentPreferencesInput) => apply(saveAgentPreferences(input)),
      [apply],
    ),
  };
}
