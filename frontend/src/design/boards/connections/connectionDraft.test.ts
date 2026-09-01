import { describe, expect, it } from "vitest";
import { AuthMechanism, MQKind } from "@/api/connection";
import type { Connection as ConnectionProfile } from "@/api/models";
import {
  emptyKafkaDraft,
  emptyMqttDraft,
  emptyRabbitMQDraft,
  emptyRocketMQDraft,
  type KafkaDraft,
  type MqttDraft,
  type RabbitMQDraft,
  type RocketMQDraft,
} from "./ConnectionForms";
import { emptyDraft, isDraftable, toDraft, toSubmission, type ProtocolDraft } from "./connectionDraft";

const rocketmq = (value: RocketMQDraft): ProtocolDraft => ({ protocol: "rocketmq", value });
const rabbitmq = (value: RabbitMQDraft): ProtocolDraft => ({ protocol: "rabbitmq", value });
const kafka = (value: KafkaDraft): ProtocolDraft => ({ protocol: "kafka", value });

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

/**
 * Kafka is the first family where authenticating with nothing is a real
 * choice rather than a blank form, and that changes what every credential
 * rule means: dropping to PLAINTEXT has to take the stored password with it,
 * or re-selecting SASL later would silently reuse a credential nobody was
 * shown.
 */
describe("the Kafka connection draft", () => {
  const newConnection = () => ({
    ...emptyKafkaDraft(),
    name: "  kafka-orders  ",
    endpoints: "  kafka-1:9092, kafka-2:9092  ",
  });

  const authenticated = () => ({
    ...newConnection(),
    mechanism: "sasl-scram" as const,
    username: "admin",
    password: "hunter2",
  });

  it("trims what the user typed and names the family", () => {
    const { draft } = toSubmission(kafka(newConnection()));
    expect(draft.name).toBe("kafka-orders");
    expect(draft.endpoints).toBe("kafka-1:9092, kafka-2:9092");
    expect(draft.kind).toBe(MQKind.KindKafka);
  });

  it("stores no credential and clears any stored one when the mechanism is none", () => {
    const submission = toSubmission(kafka({ ...newConnection(), credentialsStored: true }));
    expect(submission.draft.authMechanism).toBe(AuthMechanism.AuthNone);
    expect(submission.draft.secrets).toEqual({ username: "", password: "" });
    expect(submission.credentialsMode).toBe("clear");
  });

  // A password left in the draft after the user switched to PLAINTEXT must not
  // reach the store, or turning SASL back on would authenticate with something
  // the form never showed.
  it("drops a typed credential the mechanism no longer uses", () => {
    const submission = toSubmission(kafka({
      ...newConnection(),
      mechanism: "none",
      username: "admin",
      password: "hunter2",
    }));
    expect(submission.draft.secrets).toEqual({ username: "", password: "" });
    expect(submission.credentialsMode).toBe("clear");
  });

  it("carries each SASL mechanism through in the store's vocabulary", () => {
    expect(toSubmission(kafka({ ...authenticated(), mechanism: "sasl-plain" })).draft.authMechanism)
      .toBe(AuthMechanism.AuthSASLPlain);
    expect(toSubmission(kafka(authenticated())).draft.authMechanism)
      .toBe(AuthMechanism.AuthSASLScram);
  });

  it("stores the SCRAM digest, which is a separate credential on the broker", () => {
    const submission = toSubmission(kafka({ ...authenticated(), scramSha: "256" }));
    expect(submission.draft.options.scramSha).toBe("256");
    expect(toSubmission(kafka(authenticated())).draft.options.scramSha).toBe("512");
  });

  it("keeps a stored credential when the form was opened on one and left blank", () => {
    const submission = toSubmission(kafka({
      ...newConnection(),
      mechanism: "sasl-scram",
      credentialsStored: true,
    }));
    expect(submission.credentialsMode).toBe("preserve");
  });

  it("replaces a stored credential as soon as one is typed", () => {
    const submission = toSubmission(kafka({ ...authenticated(), credentialsStored: true }));
    expect(submission.credentialsMode).toBe("replace");
    expect(submission.draft.secrets).toEqual({ username: "admin", password: "hunter2" });
  });

  it("clears a stored credential when the clear control was used", () => {
    const submission = toSubmission(kafka({
      ...newConnection(),
      mechanism: "sasl-scram",
      credentialsStored: true,
      clearCredentials: true,
    }));
    expect(submission.credentialsMode).toBe("clear");
  });

  // Storing the TLS extras with TLS off would re-apply them the day someone
  // turns it back on, without the form ever having shown them.
  it("stores no TLS extras while TLS is off", () => {
    const submission = toSubmission(kafka({
      ...newConnection(),
      tls: false,
      tlsCaFile: "/etc/kafka/ca.pem",
      tlsSkipVerify: true,
    }));
    expect(submission.draft.options.tls).toBe("false");
    expect(submission.draft.options.tlsCaFile).toBe("");
    expect(submission.draft.options.tlsSkipVerify).toBe("false");
  });

  it("stores the TLS extras once TLS is on", () => {
    const submission = toSubmission(kafka({
      ...newConnection(),
      tls: true,
      tlsCaFile: "  /etc/kafka/ca.pem  ",
      tlsSkipVerify: true,
    }));
    expect(submission.draft.options.tls).toBe("true");
    expect(submission.draft.options.tlsCaFile).toBe("/etc/kafka/ca.pem");
    expect(submission.draft.options.tlsSkipVerify).toBe("true");
  });

  it("reads a stored profile back into the form it came from", () => {
    const profile = {
      id: 7,
      name: "kafka-orders",
      group: "prod",
      kind: MQKind.KindKafka,
      endpoints: "kafka-1:9092",
      timeoutSec: 9,
      authMechanism: AuthMechanism.AuthSASLScram,
      options: {
        scramSha: "256",
        tls: "true",
        tlsCaFile: "/etc/kafka/ca.pem",
        tlsSkipVerify: "true",
      },
      secretsConfigured: ["username", "password"],
      remark: "orders cluster",
    } as unknown as ConnectionProfile;

    const draft = toDraft(profile);
    expect(draft.protocol).toBe("kafka");
    if (draft.protocol !== "kafka") return;
    expect(draft.value).toMatchObject({
      name: "kafka-orders",
      endpoints: "kafka-1:9092",
      mechanism: "sasl-scram",
      scramSha: "256",
      tls: true,
      tlsCaFile: "/etc/kafka/ca.pem",
      tlsSkipVerify: true,
      timeoutSec: 9,
      credentialsStored: true,
      clearCredentials: false,
    });
    // Secrets never come back from the store, so the fields open blank and
    // blank has to keep meaning "leave it alone".
    expect(draft.value.username).toBe("");
    expect(draft.value.password).toBe("");
  });

  // A profile that authenticates with nothing has no credential to keep,
  // whatever is still sitting in the secret store from an earlier mechanism.
  it("reports no stored credential on a profile that does not authenticate", () => {
    const profile = {
      id: 8,
      name: "kafka-dev",
      group: "",
      kind: MQKind.KindKafka,
      endpoints: "localhost:9092",
      timeoutSec: 5,
      authMechanism: AuthMechanism.AuthNone,
      options: {},
      secretsConfigured: ["username", "password"],
      remark: "",
    } as unknown as ConnectionProfile;

    const draft = toDraft(profile);
    if (draft.protocol !== "kafka") throw new Error("expected a kafka draft");
    expect(draft.value.mechanism).toBe("none");
    expect(draft.value.credentialsStored).toBe(false);
  });
});

/*
 * MQTT is the only family here with two independent credentials: the broker's
 * username and password authenticate the session, and the management API key
 * authenticates a separate HTTP endpoint the protocol knows nothing about.
 *
 * That is why its mode rule differs from every other form's, and why these
 * tests exist: "replace" on any keystroke - which is what the
 * single-credential forms do - would submit the untouched half as blank and
 * wipe it.
 */
describe("an mqtt submission", () => {
  const draft = (over: Partial<MqttDraft> = {}): MqttDraft => ({
    ...emptyMqttDraft(),
    name: "iot",
    endpoints: "iot.example.com:1883",
    ...over,
  });

  it("stores the protocol version, transport and session settings", () => {
    const { draft: stored } = toSubmission({
      protocol: "mqtt",
      value: draft({
        protocol: "311",
        transport: "ws",
        wsPath: "/mqtt",
        clientId: "gateway-console",
        keepAliveSec: 30,
        cleanStart: false,
        sessionExpirySec: 600,
      }),
    });

    expect(stored.kind).toBe(MQKind.KindMQTT);
    expect(stored.options).toMatchObject({
      protocolVersion: "311",
      transport: "ws",
      wsPath: "/mqtt",
      clientId: "gateway-console",
      keepAliveSec: "30",
      cleanStart: "false",
      // Session expiry is 5.0 only, so a 3.1.1 profile must not carry one.
      sessionExpirySec: "0",
    });
  });

  it("drops settings the chosen transport cannot use", () => {
    const { draft: stored } = toSubmission({
      protocol: "mqtt",
      value: draft({
        transport: "tcp",
        wsPath: "/mqtt",
        tlsCaFile: "/etc/ca.pem",
        tlsSkipVerify: true,
      }),
    });

    // Storing them would re-apply them silently the day someone switches to
    // WebSocket or TLS.
    expect(stored.options?.wsPath).toBe("");
    expect(stored.options?.tlsCaFile).toBe("");
    expect(stored.options?.tlsSkipVerify).toBe("false");
  });

  it("keeps both credentials when only one of them is retyped", () => {
    const { credentialsMode } = toSubmission({
      protocol: "mqtt",
      value: draft({
        mechanism: "plain",
        managementUrl: "http://iot.example.com:18083",
        managementKey: "a-new-key",
        credentialsStored: true,
      }),
    });

    // Preserve fills blank fields per key, so the untouched broker password
    // survives. Replace would submit it as blank and wipe it.
    expect(credentialsMode).toBe("preserve");
  });

  it("replaces on a connection with nothing stored yet", () => {
    const { credentialsMode } = toSubmission({
      protocol: "mqtt",
      value: draft({ mechanism: "plain", username: "ops", password: "s3cret" }),
    });
    expect(credentialsMode).toBe("replace");
  });

  it("clears both credentials when the clear control was used", () => {
    const { credentialsMode } = toSubmission({
      protocol: "mqtt",
      value: draft({ mechanism: "plain", credentialsStored: true, clearCredentials: true }),
    });
    expect(credentialsMode).toBe("clear");
  });

  it("sends no management key without a management endpoint", () => {
    const { draft: stored } = toSubmission({
      protocol: "mqtt",
      value: draft({ managementUrl: "  ", managementKey: "orphan", managementSecret: "orphan" }),
    });

    expect(stored.options?.managementUrl).toBe("");
    expect(stored.secrets?.managementApiKey).toBe("");
    expect(stored.secrets?.managementSecretKey).toBe("");
  });

  it("reads a stored profile back into the form", () => {
    const profile = {
      id: 11,
      name: "emqx-edge",
      group: "",
      kind: MQKind.KindMQTT,
      endpoints: "iot.example.com:8883",
      timeoutSec: 7,
      authMechanism: AuthMechanism.AuthPlain,
      options: {
        protocolVersion: "5",
        transport: "wss",
        wsPath: "/mqtt",
        clientId: "",
        keepAliveSec: "45",
        cleanStart: "false",
        sessionExpirySec: "900",
        tlsCaFile: "/etc/ca.pem",
        tlsSkipVerify: "true",
        managementUrl: "http://iot.example.com:18083",
      },
      secretsConfigured: ["password", "managementApiKey"],
      remark: "",
    } as unknown as ConnectionProfile;

    const read = toDraft(profile);
    expect(read.protocol).toBe("mqtt");
    if (read.protocol !== "mqtt") return;
    expect(read.value).toMatchObject({
      endpoints: "iot.example.com:8883",
      protocol: "5",
      transport: "wss",
      keepAliveSec: 45,
      cleanStart: false,
      sessionExpirySec: 900,
      mechanism: "plain",
      tlsCaFile: "/etc/ca.pem",
      tlsSkipVerify: true,
      managementUrl: "http://iot.example.com:18083",
      credentialsStored: true,
    });
    // Secrets never come back from the store.
    expect(read.value.password).toBe("");
    expect(read.value.managementKey).toBe("");
  });

  // A profile written before the field existed carries no value, and must not
  // silently start resuming sessions: a console that resumed would inherit
  // whatever subscriptions the last window left behind.
  it("defaults clean start on for a profile that predates the field", () => {
    const profile = {
      id: 12,
      name: "old",
      group: "",
      kind: MQKind.KindMQTT,
      endpoints: "iot.example.com:1883",
      timeoutSec: 5,
      authMechanism: AuthMechanism.AuthNone,
      options: {},
      secretsConfigured: [],
      remark: "",
    } as unknown as ConnectionProfile;

    const read = toDraft(profile);
    if (read.protocol !== "mqtt") throw new Error("expected an mqtt draft");
    expect(read.value.cleanStart).toBe(true);
    expect(read.value.transport).toBe("tcp");
    expect(read.value.protocol).toBe("5");
  });
});

describe("the draft registry", () => {
  it("has an empty draft for every protocol it claims to handle", () => {
    for (const protocol of ["rocketmq", "rabbitmq", "kafka", "mqtt"] as const) {
      expect(isDraftable(protocol)).toBe(true);
      expect(emptyDraft(protocol).protocol).toBe(protocol);
    }
  });

  // The picker gates on this: a tile whose form cannot be built must not open
  // one, which is what disabling it is for.
  it("does not claim protocols with no form", () => {
    for (const protocol of ["pulsar", "redis"] as const) {
      expect(isDraftable(protocol)).toBe(false);
    }
  });
});
