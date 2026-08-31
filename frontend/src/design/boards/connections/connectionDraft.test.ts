import { describe, expect, it } from "vitest";
import { AuthMechanism, MQKind } from "@/api/connection";
import type { Connection as ConnectionProfile } from "@/api/models";
import { emptyRabbitMQDraft, emptyRocketMQDraft, type RabbitMQDraft, type RocketMQDraft } from "./ConnectionForms";
import { emptyDraft, isDraftable, toDraft, toSubmission, type ProtocolDraft } from "./connectionDraft";

const rocketmq = (value: RocketMQDraft): ProtocolDraft => ({ protocol: "rocketmq", value });
const rabbitmq = (value: RabbitMQDraft): ProtocolDraft => ({ protocol: "rabbitmq", value });

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
    const { draft } = toSubmission(rocketmq(newConnection()));
    expect(draft.name).toBe("rocketmq-order");
    expect(draft.endpoints).toBe("10.12.3.44:9876;10.12.3.45:9876");
    expect(draft.kind).toBe(MQKind.KindRocketMQ);
  });

  it("leaves authentication off when no credential was given", () => {
    const submission = toSubmission(rocketmq(newConnection()));
    expect(submission.draft.authMechanism).toBe(AuthMechanism.AuthNone);
    expect(submission.credentialsMode).toBe("replace");
  });

  it("turns ACL on as soon as one half is typed", () => {
    const submission = toSubmission(rocketmq({ ...newConnection(), accessKey: "admin" }));
    expect(submission.draft.authMechanism).toBe(AuthMechanism.AuthACL);
    expect(submission.draft.secrets).toEqual({ accessKey: "admin", secretKey: "" });
    expect(submission.credentialsMode).toBe("replace");
  });

  it("keeps stored credentials when an edit leaves the fields blank", () => {
    const submission = toSubmission(rocketmq({ ...newConnection(), credentialsStored: true }));
    // Editing only the name must not turn ACL off, and must not submit a blank
    // over what is stored.
    expect(submission.draft.authMechanism).toBe(AuthMechanism.AuthACL);
    expect(submission.credentialsMode).toBe("preserve");
  });

  it("overwrites only the stored halves an edit actually retyped", () => {
    const submission = toSubmission(rocketmq({
      ...newConnection(),
      credentialsStored: true,
      secretKey: "new-sk",
    }));
    // Still "preserve": under it Go takes what was typed and fills the blanks
    // from storage, which is what rotating one half of a pair means. "replace"
    // here would submit an empty AccessKey alongside the new SecretKey.
    expect(submission.credentialsMode).toBe("preserve");
    expect(submission.draft.secrets).toEqual({ accessKey: "", secretKey: "new-sk" });
  });

  it("drops authentication entirely when the clear control was used", () => {
    const submission = toSubmission(rocketmq({
      ...newConnection(),
      credentialsStored: true,
      clearCredentials: true,
    }));
    expect(submission.draft.authMechanism).toBe(AuthMechanism.AuthNone);
    expect(submission.credentialsMode).toBe("clear");
  });

  it("carries the version and access mode the driver reads back", () => {
    const { draft } = toSubmission(rocketmq({ ...newConnection(), version: "4.x", access: "ns" }));
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

    const draft = toDraft(stored);
    if (draft.protocol !== "rocketmq") throw new Error("a RocketMQ profile read back as " + draft.protocol);
    expect(draft.value.credentialsStored).toBe(true);
    expect(draft.value.accessKey).toBe("");
    expect(draft.value.secretKey).toBe("");

    const { draft: submitted } = toSubmission(draft);
    expect(submitted.group).toBe("staging");
    expect(submitted.remark).toBe("order cluster");
    expect(submitted.timeoutSec).toBe(12);
    expect(submitted.options).toEqual({ version: "4.x", access: "ns" });
  });
});

/**
 * RabbitMQ stores one password rather than a pair, and it is not optional:
 * the management API has no anonymous mode, so a connection without it reads
 * nothing at all. The rules therefore differ from RocketMQ's, which is why
 * this is its own translation rather than a branch inside one.
 */
describe("the RabbitMQ connection draft", () => {
  const newConnection = (): RabbitMQDraft => ({
    ...emptyRabbitMQDraft(),
    name: "  rabbit-staging  ",
    management: "  http://rabbit.example.com:15672  ",
    username: "  mqstudio  ",
    password: "  s3cret  ",
  });

  it("trims what the user typed and names the family", () => {
    const { draft } = toSubmission(rabbitmq(newConnection()));
    expect(draft.name).toBe("rabbit-staging");
    expect(draft.kind).toBe(MQKind.KindRabbitMQ);
  });

  // The management API is the whole admin plane, so it is the address the
  // profile stores; the AMQP side rides along as an option.
  it("stores the management address as the connection's endpoint", () => {
    const { draft } = toSubmission(rabbitmq(newConnection()));
    expect(draft.endpoints).toBe("http://rabbit.example.com:15672");
  });

  it("always authenticates, because the management API has no anonymous mode", () => {
    const { draft } = toSubmission(rabbitmq(newConnection()));
    expect(draft.authMechanism).toBe(AuthMechanism.AuthPlain);
    expect(draft.secrets).toEqual({ username: "mqstudio", password: "s3cret" });
  });

  it("defaults a blank virtual host to the root one", () => {
    const { draft } = toSubmission(rabbitmq({ ...newConnection(), vhost: "   " }));
    expect(draft.options?.vhost).toBe("/");
  });

  it("leaves the AMQP address empty so the driver derives it", () => {
    const { draft } = toSubmission(rabbitmq(newConnection()));
    expect(draft.options?.amqpEndpoint).toBe("");
  });

  it("carries an explicit AMQP address through", () => {
    const { draft } = toSubmission(
      rabbitmq({ ...newConnection(), amqp: "  amqp://other-host:5672  " }),
    );
    expect(draft.options?.amqpEndpoint).toBe("amqp://other-host:5672");
  });

  // Skipping verification only means anything with TLS on. Storing it while
  // TLS is off would silently re-apply it the day someone turns TLS back on.
  it("does not store a skip-verify that TLS is not on for", () => {
    const { draft } = toSubmission(
      rabbitmq({ ...newConnection(), tls: false, tlsSkipVerify: true }),
    );
    expect(draft.options?.tls).toBe("false");
    expect(draft.options?.tlsSkipVerify).toBe("false");
  });

  it("stores skip-verify when TLS is on and it was asked for", () => {
    const { draft } = toSubmission(
      rabbitmq({ ...newConnection(), tls: true, tlsSkipVerify: true }),
    );
    expect(draft.options?.tls).toBe("true");
    expect(draft.options?.tlsSkipVerify).toBe("true");
  });

  it("keeps the stored password when an edit leaves the fields blank", () => {
    const submission = toSubmission(
      rabbitmq({
        ...emptyRabbitMQDraft(),
        name: "rabbit-staging",
        management: "http://rabbit:15672",
        credentialsStored: true,
      }),
    );
    expect(submission.credentialsMode).toBe("preserve");
    expect(submission.draft.authMechanism).toBe(AuthMechanism.AuthPlain);
  });

  it("replaces the stored password when an edit retyped one", () => {
    const submission = toSubmission(
      rabbitmq({ ...newConnection(), credentialsStored: true }),
    );
    expect(submission.credentialsMode).toBe("replace");
  });

  it("clears the credential when the clear control was used", () => {
    const submission = toSubmission(
      rabbitmq({ ...newConnection(), credentialsStored: true, clearCredentials: true }),
    );
    expect(submission.credentialsMode).toBe("clear");
  });

  it("round-trips a stored profile without dropping what the form does not draw", () => {
    const stored = {
      id: 9,
      name: "rabbit-prod",
      group: "prod",
      kind: MQKind.KindRabbitMQ,
      endpoints: "https://rabbit.prod:15671",
      timeoutSec: 20,
      authMechanism: AuthMechanism.AuthPlain,
      options: {
        vhost: "/orders",
        amqpEndpoint: "amqps://rabbit.prod:5671",
        tls: "true",
        tlsSkipVerify: "true",
      },
      secretsConfigured: ["username", "password"],
      status: "online",
      lastCheck: "2026-08-31 09:00:00",
      isDefault: false,
      remark: "order cluster",
    } as ConnectionProfile;

    const draft = toDraft(stored);
    if (draft.protocol !== "rabbitmq") throw new Error("a RabbitMQ profile read back as " + draft.protocol);
    expect(draft.value.management).toBe("https://rabbit.prod:15671");
    expect(draft.value.amqp).toBe("amqps://rabbit.prod:5671");
    expect(draft.value.vhost).toBe("/orders");
    expect(draft.value.tls).toBe(true);
    expect(draft.value.tlsSkipVerify).toBe(true);
    // The password never comes back, only the fact that one is stored.
    expect(draft.value.username).toBe("");
    expect(draft.value.password).toBe("");
    expect(draft.value.credentialsStored).toBe(true);

    const { draft: submitted, credentialsMode } = toSubmission(draft);
    expect(credentialsMode).toBe("preserve");
    expect(submitted.group).toBe("prod");
    expect(submitted.remark).toBe("order cluster");
    expect(submitted.timeoutSec).toBe(20);
    expect(submitted.options).toEqual({
      vhost: "/orders",
      amqpEndpoint: "amqps://rabbit.prod:5671",
      tls: "true",
      tlsSkipVerify: "true",
    });
  });
});

describe("the draft registry", () => {
  it("has an empty draft for every protocol it claims to handle", () => {
    for (const protocol of ["rocketmq", "rabbitmq"] as const) {
      expect(isDraftable(protocol)).toBe(true);
      expect(emptyDraft(protocol).protocol).toBe(protocol);
    }
  });

  // The picker gates on this: a tile whose form cannot be built must not open
  // one, which is what disabling it is for.
  it("does not claim protocols with no form", () => {
    for (const protocol of ["kafka", "pulsar", "redis", "mqtt"] as const) {
      expect(isDraftable(protocol)).toBe(false);
    }
  });
});
