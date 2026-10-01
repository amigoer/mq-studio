import { useCallback, useEffect, useRef, useState } from "react";
import {
  answerAsk,
  consentAgentProvider,
  continueConversation,
  conversationSnapshot,
  deleteConversation,
  getAgentSettings,
  listConversations,
  onAgentEvent,
  renameConversation,
  saveTranscript,
  sendToConversation,
  startConversation,
  stopConversation,
  type AgentContext,
  type AgentProviderView,
  type AgentSettingsView,
  type AgentSummary,
} from "@/api/agent";
import {
  applyEvent,
  fromSnapshot,
  opened,
  titleOf,
  type Conversation,
} from "@/design/agent/conversation";

export type Assistant = ReturnType<typeof useAssistant>;

/**
 * The window's assistant: the conversation in the dock, and the set-up it
 * runs on.
 *
 * Held above the dock rather than in it, so closing the dock, or the dock
 * moving over the page on a narrow window, loses nothing - the draft
 * included. Go holds the conversation itself; this follows it through the
 * numbered events, and reads it whole when one goes missing.
 */
export function useAssistant() {
  const [settings, setSettings] = useState<AgentSettingsView | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  // The service the open conversation runs on, which the settings may since
  // have stopped calling the default.
  const [providerId, setProviderId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // The history list, read when it is opened; null until then.
  const [sessions, setSessions] = useState<AgentSummary[] | null>(null);
  const current = useRef<Conversation | null>(null);
  const reading = useRef(false);

  const commit = useCallback((next: Conversation | null) => {
    current.current = next;
    setConversation(next);
  }, []);

  const reread = useCallback(
    async (session: string) => {
      if (reading.current) return;
      reading.current = true;
      try {
        const snapshot = await conversationSnapshot(session);
        if (current.current?.session === session) commit(fromSnapshot(snapshot));
      } catch {
        // The next event finds the same gap and asks again.
      } finally {
        reading.current = false;
      }
    },
    [commit],
  );

  useEffect(
    () =>
      onAgentEvent((event) => {
        if (event.kind === "gone") {
          setSessions((list) => list?.filter((one) => one.id !== event.session) ?? null);
          if (current.current?.session === event.session) {
            setProviderId(null);
            commit(null);
          }
          return;
        }
        const state = current.current;
        if (state == null || event.session !== state.session) return;
        const next = applyEvent(state, event);
        if (next === "gap") void reread(state.session);
        else if (next !== state) commit(next);
      }),
    [commit, reread],
  );

  const refresh = useCallback(async () => {
    const next = await getAgentSettings();
    setSettings(next);
    return next;
  }, []);

  /*
   * A window that reloads finds the conversation it had, which Go still
   * holds. One only on disk is not reopened unasked: the window opening is
   * not a reason to put last month's conversation in front of somebody.
   */
  useEffect(() => {
    let cancelled = false;
    refresh().catch(() => {});
    listConversations()
      .then(async (summaries) => {
        const newest = summaries?.find((summary) => summary.open);
        if (cancelled || newest == null || current.current != null) return;
        const snapshot = await conversationSnapshot(newest.id);
        if (cancelled || current.current != null) return;
        setProviderId(newest.provider);
        commit(fromSnapshot(snapshot));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [commit, refresh]);

  const provider: AgentProviderView | null = (() => {
    if (settings == null) return null;
    const id = providerId ?? (settings.default !== "" ? settings.default : settings.providers[0]?.id);
    return settings.providers.find((one) => one.id === id) ?? null;
  })();
  const consented = provider != null && (settings?.consented ?? []).includes(provider.id);
  // A conversation goes on on the service it began on; one deleted since
  // leaves it with nowhere to go.
  const serviceGone = settings != null && providerId != null && provider == null;

  const listSessions = useCallback(async () => {
    const list = await listConversations();
    setSessions(list);
    return list;
  }, []);

  const session = () => current.current?.session;

  return {
    settings,
    conversation,
    provider,
    consented,
    serviceGone,
    draft,
    setDraft,
    refresh,
    sessions,
    listSessions,
    /** Puts a conversation in the dock, read back from disk if need be. */
    open: useCallback(
      async (summary: AgentSummary) => {
        const snapshot = await conversationSnapshot(summary.id);
        setProviderId(summary.provider);
        commit(fromSnapshot(snapshot));
      },
      [commit],
    ),
    rename: useCallback(
      async (id: string, title: string) => {
        await renameConversation(id, title);
        await listSessions();
      },
      [listSessions],
    ),
    remove: useCallback(
      async (id: string) => {
        await deleteConversation(id);
        await listSessions();
      },
      [listSessions],
    ),
    /** Writes a conversation to a file the person picks; null when they cancel. */
    exportTranscript: useCallback(async (id: string, markdownOf: (conversation: Conversation) => string) => {
      const conversation =
        current.current?.session === id ? current.current : fromSnapshot(await conversationSnapshot(id));
      return saveTranscript(titleOf(conversation), markdownOf(conversation));
    }, []),
    consent: useCallback(async () => {
      if (provider == null) return;
      setSettings(await consentAgentProvider(provider.id));
    }, [provider]),
    send: useCallback(
      async (text: string, where: AgentContext) => {
        let state = current.current;
        if (state == null) {
          const summary = await startConversation(providerId ?? "");
          setProviderId(summary.provider);
          state = opened(summary.id, summary.model);
          commit(state);
        }
        await sendToConversation(state.session, text, where);
      },
      [commit, providerId],
    ),
    carryOn: useCallback(async () => {
      const id = session();
      if (id != null) await continueConversation(id);
    }, []),
    stop: useCallback(async () => {
      const id = session();
      if (id != null) await stopConversation(id);
    }, []),
    decide: useCallback(async (ask: string, approve: boolean, remember: boolean) => {
      const id = session();
      if (id != null) await answerAsk(id, ask, approve, remember);
    }, []),
    /** Leaves the conversation where it is and opens the next on the default. */
    startOver: useCallback(() => {
      setProviderId(null);
      commit(null);
    }, [commit]),
  };
}
