import { ConnectionService } from "@bindings/bridge";
import type { ConnectionInput } from "@bindings/bridge/models";
import { AuthMechanism, MQKind } from "@bindings/model/models";

/**
 * Builds the profile shape the bridge now takes.
 *
 * The caller still speaks RocketMQ - a name server and an ACL key pair -
 * because the connection form has not been rebuilt from the driver's schema
 * yet. This is the one place that knows how those map onto endpoints, an auth
 * mechanism and a secrets map, and it goes away when the form does.
 */
function connectionInput(
  name: string,
  group: string,
  nameServer: string,
  timeoutSec: number,
  enableACL: boolean,
  accessKey: string,
  secretKey: string,
  remark: string,
  extra: { credentialsMode: ConnectionInput["credentialsMode"] },
): ConnectionInput {
  return {
    name,
    group,
    kind: MQKind.KindRocketMQ,
    endpoints: nameServer,
    timeoutSec,
    authMechanism: enableACL ? AuthMechanism.AuthACL : AuthMechanism.AuthNone,
    options: {},
    secrets: { accessKey, secretKey },
    remark,
    credentialsMode: extra.credentialsMode,
  };
}
import type { Connection } from "./models";
import { present, required } from "./client";

export const getConnections = (): Promise<Connection[]> =>
  ConnectionService.List().then(present);

export function addConnection(
  name: string,
  group: string,
  nameServer: string,
  timeoutSec: number,
  enableACL: boolean,
  accessKey: string,
  secretKey: string,
  remark: string,
): Promise<Connection> {
  return ConnectionService.Add(
    connectionInput(
      name,
      group,
      nameServer,
      timeoutSec,
      enableACL,
      accessKey,
      secretKey,
      remark,
      {
        credentialsMode: enableACL ? "replace" : "clear",
      },
    ),
  ).then(required);
}

export function updateConnection(
  id: number,
  name: string,
  group: string,
  nameServer: string,
  timeoutSec: number,
  enableACL: boolean,
  accessKey: string,
  secretKey: string,
  remark: string,
): Promise<Connection> {
  const credentialsMode: ConnectionInput["credentialsMode"] = !enableACL
    ? "clear"
    : accessKey || secretKey
      ? "replace"
      : "preserve";
  return ConnectionService.Update(
    id,
    connectionInput(
      name,
      group,
      nameServer,
      timeoutSec,
      enableACL,
      accessKey,
      secretKey,
      remark,
      {
        credentialsMode,
      },
    ),
  ).then(required);
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
