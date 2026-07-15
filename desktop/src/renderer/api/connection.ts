import type { Connection } from '@generated/models'
import { callBackend } from './client'

interface ConnectionInput {
  name: string
  env: string
  nameServer: string
  timeoutSec: number
  enableACL: boolean
  accessKey: string
  secretKey: string
  remark: string
  credentialsMode: 'preserve' | 'replace' | 'clear'
}

export const getConnections = (): Promise<Connection[]> => callBackend('connections.list')

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
  return callBackend('connections.add', {
    name,
    env,
    nameServer,
    timeoutSec,
    enableACL,
    accessKey,
    secretKey,
    remark,
    credentialsMode: enableACL ? 'replace' : 'clear',
  })
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
  const input: ConnectionInput = {
    name,
    env,
    nameServer,
    timeoutSec,
    enableACL,
    accessKey,
    secretKey,
    remark,
    credentialsMode,
  }
  return callBackend('connections.update', { id, input })
}

export const deleteConnection = (id: number): Promise<void> =>
  callBackend('connections.remove', { id })
export const connect = (id: number): Promise<void> => callBackend('connections.connect', { id })
export const disconnect = (id: number): Promise<void> =>
  callBackend('connections.disconnect', { id })
export const connectDefault = (): Promise<void> => callBackend('connections.connectDefault')
export const setDefaultConnection = (id: number): Promise<void> =>
  callBackend('connections.setDefault', { id })
export async function testConnection(id: number): Promise<string> {
  return (await callBackend<{ status: string }>('connections.test', { id })).status
}
