/**
 * Each protocol's form fields translated into what ConnectionService stores.
 *
 * It lives beside the forms rather than inside them because the credentials
 * rules are the part worth testing: secrets are stored encrypted and never
 * come back, so a blank field means different things on a new connection, on
 * an edit, and after the clear control was used - and getting that wrong
 * either drops a working credential or stores an empty one.
 *
 * The draft is a union rather than one shared shape. A RocketMQ connection is
 * name servers and an ACL pair; a RabbitMQ one is two addresses, a virtual
 * host and a password. Flattening them into one record would mean every field
 * carrying a note about which protocols it applies to.
 */
import {
  AuthMechanism,
  MQKind,
  type ConnectionDraft,
  type CredentialsMode,
} from "@/api/connection";
import type { Connection as ConnectionProfile } from "@/api/models";
import type { ProtocolId } from "@/design/data/protocols";
import {
  OPTION_ACCESS,
  OPTION_AMQP,
  OPTION_TLS,
  OPTION_TLS_SKIP_VERIFY,
  OPTION_VERSION,
  OPTION_VHOST,
  emptyRabbitMQDraft,
  emptyRocketMQDraft,
  type RabbitMQDraft,
  type RocketMQDraft,
} from "./ConnectionForms";

export interface Submission {
  draft: ConnectionDraft;
  credentialsMode: CredentialsMode;
}

/** One protocol's form state, tagged so the dialog can dispatch on it. */
export type ProtocolDraft =
  | { protocol: "rocketmq"; value: RocketMQDraft }
  | { protocol: "rabbitmq"; value: RabbitMQDraft };

/** The protocols this file can build a submission for. */
export const DRAFTABLE: readonly ProtocolDraft["protocol"][] = ["rocketmq", "rabbitmq"];

export function isDraftable(protocol: ProtocolId): protocol is ProtocolDraft["protocol"] {
  return (DRAFTABLE as readonly string[]).includes(protocol);
}

export function emptyDraft(protocol: ProtocolDraft["protocol"]): ProtocolDraft {
  return protocol === "rabbitmq"
    ? { protocol, value: emptyRabbitMQDraft() }
    : { protocol, value: emptyRocketMQDraft() };
}

export function toSubmission(draft: ProtocolDraft): Submission {
  return draft.protocol === "rabbitmq"
    ? rabbitMQSubmission(draft.value)
    : rocketMQSubmission(draft.value);
}

/** Reads a stored profile back into its own form's field set. */
export function toDraft(profile: ConnectionProfile): ProtocolDraft {
  return profile.kind === MQKind.KindRabbitMQ
    ? { protocol: "rabbitmq", value: toRabbitMQDraft(profile) }
    : { protocol: "rocketmq", value: toRocketMQDraft(profile) };
}

function rocketMQSubmission(draft: RocketMQDraft): Submission {
  const accessKey = draft.accessKey.trim();
  const secretKey = draft.secretKey.trim();
  const typed = accessKey !== "" || secretKey !== "";
  const keepStored = draft.credentialsStored && !draft.clearCredentials;
  return {
    draft: {
      name: draft.name.trim(),
      group: draft.group,
      kind: MQKind.KindRocketMQ,
      endpoints: draft.endpoints.trim(),
      timeoutSec: draft.timeoutSec,
      authMechanism: typed || keepStored ? AuthMechanism.AuthACL : AuthMechanism.AuthNone,
      options: { [OPTION_VERSION]: draft.version, [OPTION_ACCESS]: draft.access },
      secrets: { accessKey, secretKey },
      remark: draft.remark,
    },
    credentialsMode: draft.clearCredentials ? "clear" : keepStored ? "preserve" : "replace",
  };
}

function rabbitMQSubmission(draft: RabbitMQDraft): Submission {
  const username = draft.username.trim();
  const password = draft.password.trim();
  const typed = username !== "" || password !== "";
  const keepStored = draft.credentialsStored && !draft.clearCredentials;
  return {
    draft: {
      name: draft.name.trim(),
      group: draft.group,
      kind: MQKind.KindRabbitMQ,
      // The management API is the connection's address: it is the whole admin
      // plane, and the AMQP side is derived from it when left blank.
      endpoints: draft.management.trim(),
      timeoutSec: draft.timeoutSec,
      // RabbitMQ has no anonymous management API. A connection with no
      // credential cannot read anything, so the mechanism is not conditional
      // the way RocketMQ's optional ACL is.
      authMechanism: AuthMechanism.AuthPlain,
      options: {
        [OPTION_VHOST]: draft.vhost.trim() === "" ? "/" : draft.vhost.trim(),
        [OPTION_AMQP]: draft.amqp.trim(),
        [OPTION_TLS]: String(draft.tls),
        // Only meaningful with TLS on, and storing it otherwise would re-apply
        // it silently the day someone turns TLS back on.
        [OPTION_TLS_SKIP_VERIFY]: String(draft.tls && draft.tlsSkipVerify),
      },
      secrets: { username, password },
      remark: draft.remark,
    },
    credentialsMode: draft.clearCredentials ? "clear" : typed || !keepStored ? "replace" : "preserve",
  };
}

function toRocketMQDraft(profile: ConnectionProfile): RocketMQDraft {
  return {
    name: profile.name,
    version: profile.options?.[OPTION_VERSION] === "4.x" ? "4.x" : "5.x",
    access: profile.options?.[OPTION_ACCESS] === "proxy" ? "proxy" : "ns",
    endpoints: profile.endpoints,
    accessKey: "",
    secretKey: "",
    group: profile.group,
    remark: profile.remark,
    timeoutSec: profile.timeoutSec,
    credentialsStored: profile.secretsConfigured.length > 0,
    clearCredentials: false,
  };
}

function toRabbitMQDraft(profile: ConnectionProfile): RabbitMQDraft {
  const tls = profile.options?.[OPTION_TLS] === "true";
  return {
    name: profile.name,
    management: profile.endpoints,
    amqp: profile.options?.[OPTION_AMQP] ?? "",
    vhost: profile.options?.[OPTION_VHOST] ?? "/",
    username: "",
    password: "",
    tls,
    tlsSkipVerify: tls && profile.options?.[OPTION_TLS_SKIP_VERIFY] === "true",
    group: profile.group,
    remark: profile.remark,
    timeoutSec: profile.timeoutSec,
    credentialsStored: profile.secretsConfigured.length > 0,
    clearCredentials: false,
  };
}
