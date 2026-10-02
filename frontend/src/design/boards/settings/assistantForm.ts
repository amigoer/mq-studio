import type { AgentFailure, AgentProviderInput, AgentProviderView } from "@/api/agent";

/** The two protocols Go speaks; see internal/agent/provider. */
export type ProviderKind = "anthropic" | "openai";

/** What the model service dialog edits. */
export interface ProviderDraft {
  /** Empty for a service not saved yet. */
  id: string;
  kind: ProviderKind;
  name: string;
  baseURL: string;
  /** What was typed. A stored key never comes back from Go to fill this. */
  apiKey: string;
  /** Editing a service whose key is set: a blank field then keeps it. */
  keyStored: boolean;
  /** Set by the clear control, so a blank field stops meaning "keep it". */
  clearKey: boolean;
  model: string;
  proxy: string;
  fallback: boolean;
}

/**
 * The model a new service starts on. The Messages API has one worth starting
 * on; a compatible service could be running anything, so it starts empty and
 * the listing or the person fills it.
 */
export const DEFAULT_MODEL: Record<ProviderKind, string> = {
  anthropic: "claude-opus-5-5",
  openai: "",
};

/** Where a service with no base URL is reached, shown as the placeholder. */
export const DEFAULT_BASE_URL: Record<ProviderKind, string> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
};

export function emptyDraft(kind: ProviderKind, name: string): ProviderDraft {
  return {
    id: "",
    kind,
    name,
    baseURL: "",
    apiKey: "",
    keyStored: false,
    clearKey: false,
    model: DEFAULT_MODEL[kind],
    proxy: "",
    // On wherever it can apply: a declined request answered by another model
    // beats a refusal, and the switch is there for the gateway that rejects it.
    fallback: kind === "anthropic",
  };
}

export function draftOf(view: AgentProviderView): ProviderDraft {
  return {
    id: view.id,
    kind: view.kind === "openai" ? "openai" : "anthropic",
    name: view.name,
    baseURL: view.baseURL,
    apiKey: "",
    keyStored: view.apiKeyConfigured,
    clearKey: false,
    model: view.model,
    proxy: view.proxy,
    fallback: view.fallback,
  };
}

/**
 * How a save treats the stored key. Typing one replaces it whatever else was
 * done; otherwise the clear control clears it, and a blank field keeps it.
 */
export function keyMode(draft: ProviderDraft): "preserve" | "replace" | "clear" {
  if (draft.apiKey.trim() !== "") return "replace";
  if (draft.clearKey) return "clear";
  return "preserve";
}

/** Whether the service will have a key once the draft is saved. */
export function hasKey(draft: ProviderDraft): boolean {
  return draft.apiKey.trim() !== "" || (draft.keyStored && !draft.clearKey);
}

export function inputOf(draft: ProviderDraft): AgentProviderInput {
  return {
    id: draft.id,
    name: draft.name.trim(),
    kind: draft.kind,
    baseURL: draft.baseURL.trim(),
    model: draft.model.trim(),
    proxy: draft.proxy.trim(),
    fallback: draft.kind === "anthropic" && draft.fallback,
    apiKey: draft.apiKey.trim(),
    apiKeyMode: keyMode(draft),
  };
}

const MISSING = "page.settings.assistant.form.missing.";

function urlWith(value: string, schemes: readonly string[]): boolean {
  try {
    const parsed = new URL(value);
    return schemes.includes(parsed.protocol.replace(/:$/, "")) && parsed.host !== "";
  } catch {
    return false;
  }
}

/**
 * Why the draft cannot be tested yet, as a locale key, or null. A test needs
 * everything a call needs, which is all of it but the name.
 */
export function untestable(draft: ProviderDraft): string | null {
  if (draft.kind === "anthropic" && !hasKey(draft)) return `${MISSING}key`;
  if (draft.baseURL.trim() !== "" && !urlWith(draft.baseURL.trim(), ["http", "https"])) {
    return `${MISSING}baseURL`;
  }
  if (draft.proxy.trim() !== "" && !urlWith(draft.proxy.trim(), ["http", "https", "socks5", "socks5h"])) {
    return `${MISSING}proxy`;
  }
  if (draft.model.trim() === "") return `${MISSING}model`;
  return null;
}

/** Why the draft cannot be saved yet, as a locale key, or null. */
export function unsavable(draft: ProviderDraft): string | null {
  if (draft.name.trim() === "") return `${MISSING}name`;
  return untestable(draft);
}

/** The locale key that says what a failure means for the person reading it. */
export function failureKey(failure: AgentFailure): string {
  switch (failure.reason) {
    case "auth":
    case "notFound":
    case "rejected":
    case "rateLimited":
    case "server":
    case "unreachable":
    case "timeout":
    case "unlisted":
      return `page.settings.assistant.failure.${failure.reason}`;
    default:
      return "page.settings.assistant.failure.other";
  }
}

/** The host a service is reached at, for the line under its name. */
export function hostOf(view: Pick<AgentProviderView, "kind" | "baseURL">): string {
  const base = view.baseURL !== "" ? view.baseURL : DEFAULT_BASE_URL[view.kind === "openai" ? "openai" : "anthropic"];
  try {
    const parsed = new URL(base);
    return parsed.host + (parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, ""));
  } catch {
    return base;
  }
}
