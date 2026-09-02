import { describe, expect, it } from "vitest";
import { AuthMechanism, MQKind } from "@/api/connection";
import type { Connection as ConnectionProfile } from "@/api/models";
import {
  emptyKafkaDraft,
  emptyPulsarDraft,
  emptyRabbitMQDraft,
  emptyRedisDraft,
  emptyRocketMQDraft,
  type KafkaDraft,
  type PulsarDraft,
  type RabbitMQDraft,
  type RedisDraft,
  type RocketMQDraft,
} from "./ConnectionForms";
import { emptyDraft, isDraftable, toDraft, toSubmission, type ProtocolDraft } from "./connectionDraft";

const rocketmq = (value: RocketMQDraft): ProtocolDraft => ({ protocol: "rocketmq", value });
const rabbitmq = (value: RabbitMQDraft): ProtocolDraft => ({ protocol: "rabbitmq", value });
const kafka = (value: KafkaDraft): ProtocolDraft => ({ protocol: "kafka", value });
const pulsar = (value: PulsarDraft): ProtocolDraft => ({ protocol: "pulsar", value });
const redis = (value: RedisDraft): ProtocolDraft => ({ protocol: "redis", value });

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

/**
 * Pulsar stores one secret, and the switch that turns it off has to mean it.
 *
 * The two addresses are the other half: they are separate listeners, routinely
 * behind separate ingresses, and neither is derived from the other. A
 * submission that dropped one would produce a connection that dials a broker
 * it can never administer, or administers a cluster it can never publish to.
 */
describe("the Pulsar connection draft", () => {
  const newConnection = () => ({
    ...emptyPulsarDraft(),
    name: "  pulsar-orders  ",
    service: "  pulsar://broker:6650  ",
    admin: "  http://broker:8080  ",
    tenant: "  ecommerce  ",
    namespace: "  orders  ",
  });

  it("trims what the user typed and names the family", () => {
    const { draft } = toSubmission(pulsar(newConnection()));
    expect(draft.name).toBe("pulsar-orders");
    expect(draft.kind).toBe(MQKind.KindPulsar);
    // The broker's own address is the connection's endpoints; the admin API
    // is a second address beside it.
    expect(draft.endpoints).toBe("pulsar://broker:6650");
    expect(draft.options.adminUrl).toBe("http://broker:8080");
    expect(draft.options.tenant).toBe("ecommerce");
    expect(draft.options.namespace).toBe("orders");
  });

  it("leaves authentication off until Token is chosen", () => {
    const submission = toSubmission(pulsar(newConnection()));
    expect(submission.draft.authMechanism).toBe(AuthMechanism.AuthNone);
    expect(submission.draft.secrets).toEqual({ token: "" });
  });

  it("carries the token once Token is chosen", () => {
    const submission = toSubmission(
      pulsar({ ...newConnection(), auth: "token", token: "  a-jwt  " }),
    );
    expect(submission.draft.authMechanism).toBe(AuthMechanism.AuthToken);
    expect(submission.draft.secrets).toEqual({ token: "a-jwt" });
    expect(submission.credentialsMode).toBe("replace");
  });

  it("keeps a stored token when an edit leaves the field blank", () => {
    const submission = toSubmission(
      pulsar({ ...newConnection(), auth: "token", credentialsStored: true }),
    );
    // Editing only the namespace must not submit a blank over the token.
    expect(submission.credentialsMode).toBe("preserve");
  });

  /*
   * Turning authentication off clears the stored token.
   *
   * Preserving it would leave a credential nobody can see attached to a
   * connection that says it authenticates with nothing - and it would come
   * back the day someone re-selects Token, without ever being shown.
   */
  it("clears the stored token when authentication is switched off", () => {
    const submission = toSubmission(
      pulsar({ ...newConnection(), auth: "none", credentialsStored: true }),
    );
    expect(submission.draft.authMechanism).toBe(AuthMechanism.AuthNone);
    expect(submission.draft.secrets).toEqual({ token: "" });
    expect(submission.credentialsMode).toBe("clear");
  });

  it("clears it on request even while Token is selected", () => {
    const submission = toSubmission(
      pulsar({
        ...newConnection(),
        auth: "token",
        credentialsStored: true,
        clearCredentials: true,
      }),
    );
    expect(submission.credentialsMode).toBe("clear");
  });

  // TLS settings that are stored while TLS is off come back the day someone
  // turns it on, without being shown. The submission drops them instead.
  it("does not store TLS settings while TLS is off", () => {
    const submission = toSubmission(
      pulsar({ ...newConnection(), tls: false, tlsCaFile: "/etc/pulsar/ca.pem", tlsSkipVerify: true }),
    );
    expect(submission.draft.options.tlsCaFile).toBe("");
    expect(submission.draft.options.tlsSkipVerify).toBe("false");
  });

  it("reads a stored profile back into the form it came from", () => {
    const profile = {
      id: 11,
      name: "pulsar-orders",
      group: "prod",
      kind: MQKind.KindPulsar,
      endpoints: "pulsar+ssl://broker:6651",
      timeoutSec: 9,
      authMechanism: AuthMechanism.AuthToken,
      options: {
        adminUrl: "https://broker:8443",
        tenant: "ecommerce",
        namespace: "orders",
        tls: "true",
        tlsCaFile: "/etc/pulsar/ca.pem",
        tlsSkipVerify: "true",
      },
      secretsConfigured: ["token"],
      remark: "orders cluster",
    } as unknown as ConnectionProfile;

    const draft = toDraft(profile);
    expect(draft.protocol).toBe("pulsar");
    if (draft.protocol !== "pulsar") return;
    expect(draft.value).toMatchObject({
      name: "pulsar-orders",
      service: "pulsar+ssl://broker:6651",
      admin: "https://broker:8443",
      tenant: "ecommerce",
      namespace: "orders",
      auth: "token",
      tls: true,
      tlsCaFile: "/etc/pulsar/ca.pem",
      tlsSkipVerify: true,
      credentialsStored: true,
    });
    // A stored token never comes back, and a form that showed one would be
    // showing something it cannot submit.
    expect(draft.value.token).toBe("");
  });

  /*
   * A profile that authenticates with nothing has no credential to keep,
   * whatever is still sitting in the secret store.
   *
   * Reading it as stored would open the form on a token nobody can see, and
   * the next save would preserve a credential the connection does not use.
   */
  it("does not report a stored token on a profile that authenticates with none", () => {
    const profile = {
      id: 12,
      name: "pulsar-open",
      group: "",
      kind: MQKind.KindPulsar,
      endpoints: "pulsar://broker:6650",
      timeoutSec: 5,
      authMechanism: AuthMechanism.AuthNone,
      options: { adminUrl: "http://broker:8080" },
      secretsConfigured: ["token"],
      remark: "",
    } as unknown as ConnectionProfile;

    const draft = toDraft(profile);
    if (draft.protocol !== "pulsar") throw new Error("expected a pulsar draft");
    expect(draft.value.auth).toBe("none");
    expect(draft.value.credentialsStored).toBe(false);
  });
});

describe("the draft registry", () => {
  it("has an empty draft for every protocol it claims to handle", () => {
    for (const protocol of ["rocketmq", "rabbitmq", "kafka", "pulsar", "redis"] as const) {
      expect(isDraftable(protocol)).toBe(true);
      expect(emptyDraft(protocol).protocol).toBe(protocol);
    }
  });

  // The picker gates on this: a tile whose form cannot be built must not open
  // one, which is what disabling it is for.
  it("does not claim protocols with no form", () => {
    for (const protocol of ["mqtt"] as const) {
      expect(isDraftable(protocol)).toBe(false);
    }
  });
});

/**
 * The deployment is the field the rest of the Redis form hangs off, so what
 * has to be pinned is what happens when it changes. A master name left behind
 * by a sentinel profile, or a database index left behind by a standalone one,
 * would be sent to a driver that reads them - and a cluster refuses SELECT
 * outright, so a stale 3 is a connection that fails on its first command.
 */
describe("the Redis connection draft", () => {
  const newConnection = () => ({
    ...emptyRedisDraft(),
    name: "  redis-orders  ",
    endpoints: "  10.2.0.8:6379  ",
  });

  it("trims the name and the address, and stores the deployment", () => {
    const { draft, credentialsMode } = toSubmission(redis(newConnection()));
    expect(draft.kind).toBe(MQKind.KindRedisStream);
    expect(draft.name).toBe("redis-orders");
    expect(draft.endpoints).toBe("10.2.0.8:6379");
    expect(draft.options.deployment).toBe("standalone");
    // Nothing typed and nothing stored is an anonymous server, which Redis
    // genuinely allows - not an unfinished form.
    expect(draft.authMechanism).toBe(AuthMechanism.AuthNone);
    expect(credentialsMode).toBe("replace");
  });

  it("marks a connection that carries a credential as authenticating", () => {
    const { draft, credentialsMode } = toSubmission(
      redis({ ...newConnection(), username: "mqstudio", password: "mqstudio" }),
    );
    expect(draft.authMechanism).toBe(AuthMechanism.AuthPlain);
    expect(draft.secrets).toEqual({ username: "mqstudio", password: "mqstudio" });
    expect(credentialsMode).toBe("replace");
  });

  // Redis before 6 has no users at all, so a password with no username is a
  // complete credential rather than half of one.
  it("takes a password with no username", () => {
    const { draft } = toSubmission(redis({ ...newConnection(), password: "hunter2" }));
    expect(draft.authMechanism).toBe(AuthMechanism.AuthPlain);
    expect(draft.secrets).toEqual({ username: "", password: "hunter2" });
  });

  it("keeps a stored credential when the fields are left blank on an edit", () => {
    const { draft, credentialsMode } = toSubmission(
      redis({ ...newConnection(), credentialsStored: true }),
    );
    expect(draft.authMechanism).toBe(AuthMechanism.AuthPlain);
    expect(credentialsMode).toBe("preserve");
  });

  it("clears a stored credential when the clear control was used", () => {
    const { draft, credentialsMode } = toSubmission(
      redis({ ...newConnection(), credentialsStored: true, clearCredentials: true }),
    );
    expect(draft.authMechanism).toBe(AuthMechanism.AuthNone);
    expect(credentialsMode).toBe("clear");
  });

  it("stores the master name only for a sentinel connection", () => {
    const sentinel = toSubmission(
      redis({ ...newConnection(), deployment: "sentinel", masterName: "  mymaster  " }),
    );
    expect(sentinel.draft.options.masterName).toBe("mymaster");

    // The form hides the field rather than clearing it, so a profile switched
    // back to standalone still carries the text. It must not be stored.
    const standalone = toSubmission(
      redis({ ...newConnection(), deployment: "standalone", masterName: "mymaster" }),
    );
    expect(standalone.draft.options.masterName).toBe("");
  });

  it("never sends a database index for a cluster", () => {
    const { draft } = toSubmission(redis({ ...newConnection(), deployment: "cluster", db: 3 }));
    expect(draft.options.deployment).toBe("cluster");
    expect(draft.options.db).toBe("0");
  });

  it("keeps the database index for standalone and sentinel", () => {
    expect(toSubmission(redis({ ...newConnection(), db: 4 })).draft.options.db).toBe("4");
    expect(
      toSubmission(redis({ ...newConnection(), deployment: "sentinel", masterName: "m", db: 4 }))
        .draft.options.db,
    ).toBe("4");
  });

  it("only stores skip-verify while TLS is on", () => {
    const off = toSubmission(redis({ ...newConnection(), tls: false, tlsSkipVerify: true }));
    expect(off.draft.options.tls).toBe("false");
    expect(off.draft.options.tlsSkipVerify).toBe("false");

    const on = toSubmission(redis({ ...newConnection(), tls: true, tlsSkipVerify: true }));
    expect(on.draft.options.tls).toBe("true");
    expect(on.draft.options.tlsSkipVerify).toBe("true");
  });

  it("trims the stream filter", () => {
    const { draft } = toSubmission(redis({ ...newConnection(), streamFilter: "  orders:*  " }));
    expect(draft.options.streamFilter).toBe("orders:*");
  });

  it("reads a stored profile back into the form", () => {
    const profile = {
      id: 7,
      name: "redis-orders",
      group: "prod",
      kind: MQKind.KindRedisStream,
      endpoints: "s1:26379,s2:26379",
      timeoutSec: 9,
      authMechanism: AuthMechanism.AuthPlain,
      options: {
        deployment: "sentinel",
        masterName: "mymaster",
        db: "4",
        streamFilter: "orders:*",
        tls: "true",
        tlsSkipVerify: "true",
      },
      secretsConfigured: ["username", "password"],
      remark: "the order cluster",
    } as unknown as ConnectionProfile;

    const draft = toDraft(profile);
    expect(draft.protocol).toBe("redis");
    if (draft.protocol !== "redis") return;
    expect(draft.value.deployment).toBe("sentinel");
    expect(draft.value.masterName).toBe("mymaster");
    expect(draft.value.db).toBe(4);
    expect(draft.value.streamFilter).toBe("orders:*");
    expect(draft.value.tls).toBe(true);
    expect(draft.value.tlsSkipVerify).toBe(true);
    expect(draft.value.timeoutSec).toBe(9);
    // The stored secrets never come back; what comes back is that there are
    // some, so the form can offer to keep them.
    expect(draft.value.username).toBe("");
    expect(draft.value.password).toBe("");
    expect(draft.value.credentialsStored).toBe(true);
  });

  // A profile stored before the deployment field existed is the standalone
  // server it has always connected to, which is what the driver assumes too.
  it("reads a profile with no deployment as standalone", () => {
    const profile = {
      name: "old",
      group: "",
      kind: MQKind.KindRedisStream,
      endpoints: "10.2.0.8:6379",
      timeoutSec: 0,
      authMechanism: AuthMechanism.AuthNone,
      options: {},
      secretsConfigured: [],
      remark: "",
    } as unknown as ConnectionProfile;

    const draft = toDraft(profile);
    if (draft.protocol !== "redis") throw new Error("expected a redis draft");
    expect(draft.value.deployment).toBe("standalone");
    expect(draft.value.db).toBe(0);
    expect(draft.value.masterName).toBe("");
  });

  // A stored index from a profile that used to be standalone must not travel
  // into a cluster draft, where SELECT is refused outright.
  it("drops a stored database index when the profile is a cluster", () => {
    const profile = {
      name: "moved",
      group: "",
      kind: MQKind.KindRedisStream,
      endpoints: "a:6379,b:6379",
      timeoutSec: 0,
      authMechanism: AuthMechanism.AuthNone,
      options: { deployment: "cluster", db: "7", masterName: "stale" },
      secretsConfigured: [],
      remark: "",
    } as unknown as ConnectionProfile;

    const draft = toDraft(profile);
    if (draft.protocol !== "redis") throw new Error("expected a redis draft");
    expect(draft.value.db).toBe(0);
    expect(draft.value.masterName).toBe("");
  });
});

/*
 * The picker gate and the draft registry have to agree. A tile that can be
 * selected and has no form behind it opens an empty dialog; one with a form
 * that cannot be selected is a driver nobody can reach.
 */
describe("the picker and the draft registry", () => {
  it("offers exactly the protocols a form can be built for", async () => {
    const { PROTOCOL_ORDER, isProtocolReady } = await import("@/design/data/protocols");
    for (const protocol of PROTOCOL_ORDER) {
      expect(isProtocolReady(protocol), protocol).toBe(isDraftable(protocol));
    }
  });
});
