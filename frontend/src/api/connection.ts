import { ConnectionService } from '@bindings/bridge'
import type { ConnectionInput } from '@bindings/bridge/models'
import type { Connection } from './models'
import { present, required } from './client'

export const getConnections = (): Promise<Connection[]> => ConnectionService.List().then(present)

export function addConnection(
  name: string,
  env: string,
  nameServer: string,
  timeoutSec: number,
  enableACL: boolean,
  accessKey: string,
  secretKey: string,
  remark: string,
): Promise<Connection> {
  return ConnectionService.Add({
    name,
    env,
    nameServer,
    timeoutSec,
    enableACL,
    accessKey,
    secretKey,
    remark,
    credentialsMode: enableACL ? 'replace' : 'clear',
  }).then(required)
}

export function updateConnection(
  id: number,
  name: string,
  env: string,
  nameServer: string,
  timeoutSec: number,
  enableACL: boolean,
  accessKey: string,
  secretKey: string,
  remark: string,
): Promise<Connection> {
  const credentialsMode: ConnectionInput['credentialsMode'] = !enableACL
    ? 'clear'
    : accessKey || secretKey
      ? 'replace'
      : 'preserve'
  return ConnectionService.Update(id, {
    name,
    env,
    nameServer,
    timeoutSec,
    enableACL,
    accessKey,
    secretKey,
    remark,
    credentialsMode,
  }).then(required)
}

export const deleteConnection = (id: number): Promise<void> => ConnectionService.Remove(id)
export const connect = (id: number): Promise<void> => ConnectionService.Connect(id)
export const disconnect = (id: number): Promise<void> => ConnectionService.Disconnect(id)
export const connectDefault = (): Promise<void> => ConnectionService.ConnectDefault()
export const setDefaultConnection = (id: number): Promise<void> => ConnectionService.SetDefault(id)
export const testConnection = (id: number): Promise<string> => ConnectionService.Test(id)
