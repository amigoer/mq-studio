import { AgentSettingsService } from "@bindings/bridge";
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
