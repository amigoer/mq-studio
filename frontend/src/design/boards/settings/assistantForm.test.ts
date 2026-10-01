import { describe, expect, it } from "vitest";
import {
  draftOf,
  emptyDraft,
  failureKey,
  hostOf,
  inputOf,
  keyMode,
  unsavable,
  untestable,
} from "./assistantForm";

const stored = {
  id: "a1b2c3",
  name: "Anthropic",
  kind: "anthropic",
  baseURL: "",
  model: "claude-opus-5-5",
  proxy: "",
  fallback: true,
  apiKeyConfigured: true,
};

/**
 * The key is the one field an edit form cannot show, so a blank one has to
 * mean "keep it" - and nothing else can mean that by accident.
 */
describe("the key a save sends", () => {
  it("keeps a stored key the form left blank", () => {
    const draft = draftOf(stored);
    expect(draft.apiKey).toBe("");
    expect(keyMode(draft)).toBe("preserve");
    expect(inputOf(draft).apiKey).toBe("");
  });

  it("replaces it with what was typed, even after clearing", () => {
    const draft = { ...draftOf(stored), clearKey: true, apiKey: "  sk-ant-new " };
    expect(keyMode(draft)).toBe("replace");
    expect(inputOf(draft).apiKey).toBe("sk-ant-new");
  });

  it("clears it only when told to", () => {
    expect(keyMode({ ...draftOf(stored), clearKey: true })).toBe("clear");
  });
});

describe("what a draft lacks", () => {
  it("starts a Messages API service on a model, waiting for its key", () => {
    const draft = emptyDraft("anthropic", "Anthropic");
    expect(draft.model).toBe("claude-opus-5-5");
    expect(draft.fallback).toBe(true);
    expect(untestable(draft)).toBe("page.settings.assistant.form.missing.key");
    expect(untestable({ ...draft, apiKey: "sk-ant" })).toBeNull();
  });

  it("lets a local runner go without a key, but not without a model", () => {
    const draft = { ...emptyDraft("openai", "Ollama"), baseURL: "http://127.0.0.1:11434/v1" };
    expect(draft.fallback).toBe(false);
    expect(untestable(draft)).toBe("page.settings.assistant.form.missing.model");
    expect(untestable({ ...draft, model: "qwen3:14b" })).toBeNull();
  });

  it("refuses an address that is not one", () => {
    const draft = { ...emptyDraft("openai", "x"), model: "m" };
    expect(untestable({ ...draft, baseURL: "127.0.0.1:11434" })).toBe("page.settings.assistant.form.missing.baseURL");
    expect(untestable({ ...draft, proxy: "ftp://proxy:21" })).toBe("page.settings.assistant.form.missing.proxy");
    expect(untestable({ ...draft, proxy: "socks5://127.0.0.1:7890" })).toBeNull();
  });

  it("needs a name to save, not to test", () => {
    const draft = { ...emptyDraft("anthropic", " "), apiKey: "k" };
    expect(untestable(draft)).toBeNull();
    expect(unsavable(draft)).toBe("page.settings.assistant.form.missing.name");
  });

  it("never asks a compatible service for the fallback", () => {
    const draft = { ...emptyDraft("openai", "x"), model: "m", fallback: true };
    expect(inputOf(draft).fallback).toBe(false);
  });
});

describe("what the page says", () => {
  it("names a known failure and falls back for the rest", () => {
    expect(failureKey({ reason: "auth", status: 401, detail: "" })).toBe("page.settings.assistant.failure.auth");
    expect(failureKey({ reason: "invalid", status: 0, detail: "" })).toBe("page.settings.assistant.failure.other");
  });

  it("shows where a service is reached", () => {
    expect(hostOf({ kind: "anthropic", baseURL: "" })).toBe("api.anthropic.com");
    expect(hostOf({ kind: "openai", baseURL: "http://127.0.0.1:11434/v1/" })).toBe("127.0.0.1:11434/v1");
  });
});
