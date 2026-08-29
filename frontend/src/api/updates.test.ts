import { describe, expect, it } from "vitest";
import { Phase, Policy, State } from "@bindings/update/models";
import { hasUpdate, isPolicy, isUpdateBusy, updateProgress, UPDATE_POLICIES } from "./updates";

const state = (fields: Partial<State>): State =>
  State.createFrom({ phase: Phase.PhaseIdle, total: -1, downloaded: 0, ...fields });

describe("hasUpdate", () => {
  it("is true for a newer release the user has not skipped", () => {
    expect(hasUpdate(state({ latestVersion: "1.2.0" }))).toBe(true);
  });

  it("is false with nothing newer", () => {
    expect(hasUpdate(state({ latestVersion: "" }))).toBe(false);
  });

  it("is false for the release the user skipped, and true for the next one", () => {
    expect(hasUpdate(state({ latestVersion: "1.2.0", skipped: "1.2.0" }))).toBe(false);
    expect(hasUpdate(state({ latestVersion: "1.3.0", skipped: "1.2.0" }))).toBe(true);
  });
});

describe("isUpdateBusy", () => {
  it("covers every phase the user must not start twice", () => {
    for (const phase of [Phase.PhaseChecking, Phase.PhaseDownloading, Phase.PhaseInstalling]) {
      expect(isUpdateBusy(state({ phase })), phase).toBe(true);
    }
    for (const phase of [Phase.PhaseIdle, Phase.PhaseAvailable, Phase.PhaseReady, Phase.PhaseError]) {
      expect(isUpdateBusy(state({ phase })), phase).toBe(false);
    }
  });
});

describe("updateProgress", () => {
  it("is a fraction of the total", () => {
    expect(updateProgress(state({ downloaded: 512, total: 2048 }))).toBe(0.25);
  });

  it("is null while the server sends no length", () => {
    expect(updateProgress(state({ downloaded: 512, total: -1 }))).toBeNull();
  });

  // A body longer than its Content-Length would otherwise draw past the end.
  it("never runs past one", () => {
    expect(updateProgress(state({ downloaded: 4096, total: 2048 }))).toBe(1);
  });
});

describe("isPolicy", () => {
  it("accepts the ladder and nothing else", () => {
    for (const policy of UPDATE_POLICIES) expect(isPolicy(policy)).toBe(true);
    for (const value of ["", "on", "silent", null, undefined, 3]) {
      expect(isPolicy(value), String(value)).toBe(false);
    }
  });

  it("keeps the ladder in the order the settings row offers", () => {
    expect([...UPDATE_POLICIES]).toEqual([
      Policy.PolicyOff,
      Policy.PolicyNotify,
      Policy.PolicyDownload,
      Policy.PolicyAuto,
    ]);
  });
});
