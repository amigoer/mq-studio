import { Events } from "@wailsio/runtime";
import { AgentService, AgentSettingsService } from "@bindings/bridge";
import type {
  Ask,
  Context as AgentContext,
  Event as AgentEvent,
  Item as AgentItem,
  Selection as AgentSelection,
  Snapshot as AgentSnapshot,
  Summary as AgentSummary,
  ToolItem as AgentToolItem,
} from "@bindings/agent/assistant/models";
import type { Usage as AgentUsage } from "@bindings/agent/provider/models";
import type {
  AgentFailure,
  AgentModel,
  AgentModels,
  AgentPreferencesInput,
  AgentProbe,
  AgentProviderInput,
  AgentProviderView,
  AgentSettingsView,
} from "@bindings/bridge/models";
import { required } from "./client";

export type {
  AgentContext,
  AgentEvent,
  AgentItem,
  AgentSelection,
  AgentSnapshot,
  AgentSummary,
  AgentToolItem,
  AgentUsage,
  Ask,
  AgentFailure,
  AgentModel,
  AgentModels,
  AgentPreferencesInput,
  AgentProbe,
  AgentProviderInput,
  AgentProviderView,
  AgentSettingsView,
};

// Keys go to Go and never come back: a provider view says whether one is set.
export const getAgentSettings = (): Promise<AgentSettingsView> =>
  AgentSettingsService.Get().then(required);
export const saveAgentProvider = (input: AgentProviderInput): Promise<AgentSettingsView> =>
  AgentSettingsService.SaveProvider(input).then(required);
export const deleteAgentProvider = (id: string): Promise<AgentSettingsView> =>
  AgentSettingsService.DeleteProvider(id).then(required);
export const saveAgentPreferences = (input: AgentPreferencesInput): Promise<AgentSettingsView> =>
  AgentSettingsService.SavePreferences(input).then(required);

// Both run on the form as it stands, before anything is saved, and report a
// failure in the result rather than by rejecting: a key the service refused
// is an answer to show, not an exception.
export const testAgentProvider = (input: AgentProviderInput): Promise<AgentProbe> =>
  AgentSettingsService.TestProvider(input);
export const listAgentModels = (input: AgentProviderInput): Promise<AgentModels> =>
  AgentSettingsService.ListModels(input);
export const consentAgentProvider = (id: string): Promise<AgentSettingsView> =>
  AgentSettingsService.Consent(id).then(required);

// A conversation's runs report through events, not through these promises:
// they settle as soon as Go has taken the request.
export const startConversation = (provider: string): Promise<AgentSummary> =>
  AgentService.Start(provider);
export const sendToConversation = (session: string, text: string, where: AgentContext): Promise<void> =>
  AgentService.Send(session, text, where);
export const continueConversation = (session: string): Promise<void> => AgentService.Continue(session);
export const stopConversation = (session: string): Promise<void> => AgentService.Stop(session);
export const answerAsk = (
  session: string,
  ask: string,
  approve: boolean,
  remember: boolean,
): Promise<void> => AgentService.Decide(session, ask, approve, remember);
export const conversationSnapshot = (session: string): Promise<AgentSnapshot> =>
  AgentService.Snapshot(session);
export const listConversations = (): Promise<AgentSummary[]> => AgentService.Sessions();

/**
 * Subscribes to every change to every conversation. Keep the name in step
 * with bridge.AgentEvent.
 */
export function onAgentEvent(listener: (event: AgentEvent) => void): () => void {
  return Events.On("agent:event", (event) => {
    const data = event.data as AgentEvent | undefined;
    if (data != null && typeof data === "object" && typeof data.seq === "number") listener(data);
  });
}
