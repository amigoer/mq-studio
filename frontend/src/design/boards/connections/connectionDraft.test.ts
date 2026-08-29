import { describe, expect, it } from "vitest";
import { AuthMechanism, MQKind } from "@/api/connection";
import type { Connection as ConnectionProfile } from "@/api/models";
import { emptyRocketMQDraft } from "./ConnectionForms";
import { toRocketMQDraft, toSubmission } from "./connectionDraft";

/**
 * Both halves of an ACL pair are stored encrypted and neither comes back, so
 * what a blank credential field means depends on what the form was opened on.
 * Getting it wrong either drops a working credential on an unrelated edit or
 * stores an empty one, and neither is visible until the next connect fails.
 */
describe("the RocketMQ connection draft", () => {
  const newConnection = () => ({
    ...emptyRocketMQDraft(),
    name: "  rocketmq-order  ",
    endpoints: "  10.12.3.44:9876;10.12.3.45:9876  ",
  });

  it("trims what the user typed and names the family", () => {
    const { draft } = toSubmission(newConnection());
    expect(draft.name).toBe("rocketmq-order");
    expect(draft.endpoints).toBe("10.12.3.44:9876;10.12.3.45:9876");
    expect(draft.kind).toBe(MQKind.KindRocketMQ);
  });

  it("leaves authentication off when no credential was given", () => {
    const submission = toSubmission(newConnection());
    expect(submission.draft.authMechanism).toBe(AuthMechanism.AuthNone);
    expect(submission.credentialsMode).toBe("replace");
  });

  it("turns ACL on as soon as one half is typed", () => {
    const submission = toSubmission({ ...newConnection(), accessKey: "admin" });
    expect(submission.draft.authMechanism).toBe(AuthMechanism.AuthACL);
    expect(submission.draft.secrets).toEqual({ accessKey: "admin", secretKey: "" });
    expect(submission.credentialsMode).toBe("replace");
  });

  it("keeps stored credentials when an edit leaves the fields blank", () => {
    const submission = toSubmission({ ...newConnection(), credentialsStored: true });
    // Editing only the name must not turn ACL off, and must not submit a blank
    // over what is stored.
    expect(submission.draft.authMechanism).toBe(AuthMechanism.AuthACL);
    expect(submission.credentialsMode).toBe("preserve");
  });

  it("overwrites only the stored halves an edit actually retyped", () => {
    const submission = toSubmission({
      ...newConnection(),
      credentialsStored: true,
      secretKey: "new-sk",
    });
    // Still "preserve": under it Go takes what was typed and fills the blanks
    // from storage, which is what rotating one half of a pair means. "replace"
    // here would submit an empty AccessKey alongside the new SecretKey.
    expect(submission.credentialsMode).toBe("preserve");
    expect(submission.draft.secrets).toEqual({ accessKey: "", secretKey: "new-sk" });
  });

  it("drops authentication entirely when the clear control was used", () => {
    const submission = toSubmission({
      ...newConnection(),
      credentialsStored: true,
      clearCredentials: true,
    });
    expect(submission.draft.authMechanism).toBe(AuthMechanism.AuthNone);
    expect(submission.credentialsMode).toBe("clear");
  });

  it("carries the version and access mode the driver reads back", () => {
    const { draft } = toSubmission({ ...newConnection(), version: "4.x", access: "ns" });
    expect(draft.options).toEqual({ version: "4.x", access: "ns" });
  });

  // The form draws neither, but an edit that dropped them would silently undo
  // whatever the list and the settings page had set.
  it("round-trips the fields the form does not draw", () => {
    const stored: ConnectionProfile = {
      id: 7,
      name: "prod",
      group: "staging",
      kind: MQKind.KindRocketMQ,
      endpoints: "ns:9876",
      timeoutSec: 12,
      authMechanism: AuthMechanism.AuthACL,
      options: { version: "4.x", access: "ns" },
      secretsConfigured: ["accessKey", "secretKey"],
      status: "online",
      lastCheck: "2026-08-30 10:22:11",
      isDefault: true,
      remark: "order cluster",
    } as ConnectionProfile;

    const draft = toRocketMQDraft(stored);
    expect(draft.credentialsStored).toBe(true);
    expect(draft.accessKey).toBe("");
    expect(draft.secretKey).toBe("");

    const { draft: submitted } = toSubmission(draft);
    expect(submitted.group).toBe("staging");
    expect(submitted.remark).toBe("order cluster");
    expect(submitted.timeoutSec).toBe(12);
    expect(submitted.options).toEqual({ version: "4.x", access: "ns" });
  });
});
