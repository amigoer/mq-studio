/**
 * The RocketMQ form's fields translated into what ConnectionService stores.
 *
 * It lives beside the form rather than inside it because the credentials rules
 * are the part worth testing: both halves of an ACL pair are stored encrypted
 * and neither ever comes back, so a blank field means different things on a new
 * connection, on an edit, and after the clear control was used - and getting
 * that wrong either drops a working credential or stores an empty one.
 */
import {
  AuthMechanism,
  MQKind,
  type ConnectionDraft,
  type CredentialsMode,
} from "@/api/connection";
import type { Connection as ConnectionProfile } from "@/api/models";
import { OPTION_ACCESS, OPTION_VERSION, type RocketMQDraft } from "./ConnectionForms";

export interface Submission {
  draft: ConnectionDraft;
  credentialsMode: CredentialsMode;
}

export function toSubmission(draft: RocketMQDraft): Submission {
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

/** Reads a stored profile back into the form's field set. */
export function toRocketMQDraft(profile: ConnectionProfile): RocketMQDraft {
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
