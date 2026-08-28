import { ConnectionService } from "@bindings/bridge";
import type { ConnectionInput } from "@bindings/bridge/models";
import { AuthMechanism, MQKind } from "@bindings/model/models";
import type { Connection } from "./models";
import { present, required } from "./client";

export { AuthMechanism, MQKind };

/** What the connection form submits, before secrets policy is applied. */
export interface ConnectionDraft {
  name: string;
  group: string;
  kind: MQKind;
  endpoints: string;
  timeoutSec: number;
  authMechanism: AuthMechanism;
  /** Driver-specific non-secret settings, keyed by the descriptor's field key. */
  options: Record<string, string>;
  /** Only what the user just typed; blank values are handled by credentialsMode. */
  secrets: Record<string, string>;
  remark: string;
}

/**
 * CredentialsMode says what happens to secrets the form left blank.
 *
 * The form cannot decide this on its own: a blank password means "keep the
 * stored one" while editing, but "there is none" right after the user turned
 * authentication off.
 */
export type CredentialsMode = ConnectionInput["credentialsMode"];

function toInput(
  draft: ConnectionDraft,
  credentialsMode: CredentialsMode,
): ConnectionInput {
  return {
    name: draft.name,
    group: draft.group,
    kind: draft.kind,
    endpoints: draft.endpoints,
    timeoutSec: draft.timeoutSec,
    authMechanism: draft.authMechanism,
    options: draft.options,
    secrets: draft.secrets,
    remark: draft.remark,
    credentialsMode,
  };
}

export const getConnections = (): Promise<Connection[]> =>
  ConnectionService.List().then(present);

export function addConnection(
  draft: ConnectionDraft,
  credentialsMode: CredentialsMode = "replace",
): Promise<Connection> {
  return ConnectionService.Add(toInput(draft, credentialsMode)).then(required);
}

export function updateConnection(
  id: number,
  draft: ConnectionDraft,
  credentialsMode: CredentialsMode,
): Promise<Connection> {
  return ConnectionService.Update(id, toInput(draft, credentialsMode)).then(
    required,
  );
}

export const deleteConnection = (id: number): Promise<void> =>
  ConnectionService.Remove(id);
export const connect = (id: number): Promise<void> =>
  ConnectionService.Connect(id);
export const disconnect = (id: number): Promise<void> =>
  ConnectionService.Disconnect(id);
export const connectDefault = (): Promise<void> =>
  ConnectionService.ConnectDefault();
export const setDefaultConnection = (id: number): Promise<void> =>
  ConnectionService.SetDefault(id);
export const testConnection = (id: number): Promise<string> =>
  ConnectionService.Test(id);
