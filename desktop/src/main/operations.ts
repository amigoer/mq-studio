import type { BackendCall, BackendOperation } from '../shared/bridge'
import type { DaemonSupervisor } from './daemon-supervisor'

interface RequestSpec {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  body?: unknown
}

type Payload = Record<string, unknown>
type OperationFactory = (payload: Payload) => RequestSpec

const text = (payload: Payload, key: string): string => String(payload[key] ?? '')
const number = (payload: Payload, key: string): number => Number(payload[key] ?? 0)
const query = (values: Record<string, unknown>): string => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null) params.set(key, String(value))
  }
  const encoded = params.toString()
  return encoded ? `?${encoded}` : ''
}

const operations: Record<BackendOperation, OperationFactory> = {
  'connections.list': () => ({ method: 'GET', path: '/v1/connections' }),
  'connections.add': (p) => ({ method: 'POST', path: '/v1/connections', body: p }),
  'connections.update': (p) => ({
    method: 'PUT',
    path: `/v1/connections/${number(p, 'id')}`,
    body: p.input,
  }),
  'connections.remove': (p) => ({ method: 'DELETE', path: `/v1/connections/${number(p, 'id')}` }),
  'connections.connect': (p) => ({
    method: 'POST',
    path: `/v1/connections/${number(p, 'id')}/connect`,
  }),
  'connections.disconnect': (p) => ({
    method: 'POST',
    path: `/v1/connections/${number(p, 'id')}/disconnect`,
  }),
  'connections.connectDefault': () => ({ method: 'POST', path: '/v1/connections/connect-default' }),
  'connections.setDefault': (p) => ({
    method: 'POST',
    path: `/v1/connections/${number(p, 'id')}/default`,
  }),
  'connections.test': (p) => ({ method: 'POST', path: `/v1/connections/${number(p, 'id')}/test` }),
  'settings.get': () => ({ method: 'GET', path: '/v1/settings' }),
  'settings.update': (p) => ({ method: 'PUT', path: '/v1/settings', body: p }),
  'settings.reset': () => ({ method: 'POST', path: '/v1/settings/reset' }),
  'settings.clearCache': () => ({ method: 'POST', path: '/v1/settings/clear-cache' }),
  'cluster.info': () => ({ method: 'GET', path: '/v1/cluster' }),
  'cluster.summary': () => ({ method: 'GET', path: '/v1/cluster/summary' }),
  'cluster.brokers': () => ({ method: 'GET', path: '/v1/cluster/brokers' }),
  'cluster.brokerDetail': (p) => ({
    method: 'GET',
    path: `/v1/cluster/brokers/detail${query({ brokerAddr: text(p, 'brokerAddr') })}`,
  }),
  'topics.list': () => ({ method: 'GET', path: '/v1/topics' }),
  'topics.listAll': () => ({ method: 'GET', path: '/v1/topics?scope=all' }),
  'topics.detail': (p) => ({
    method: 'GET',
    path: `/v1/topics/detail${query({ topic: text(p, 'topic') })}`,
  }),
  'topics.stats': (p) => ({
    method: 'GET',
    path: `/v1/topics/stats${query({ topic: text(p, 'topic') })}`,
  }),
  'topics.create': (p) => ({ method: 'POST', path: '/v1/topics', body: p }),
  'topics.update': (p) => ({ method: 'PUT', path: '/v1/topics', body: p }),
  'topics.remove': (p) => ({
    method: 'DELETE',
    path: `/v1/topics${query({ topic: text(p, 'topic'), clusterName: text(p, 'clusterName') })}`,
  }),
  'consumers.list': () => ({ method: 'GET', path: '/v1/consumers' }),
  'consumers.detail': (p) => ({
    method: 'GET',
    path: `/v1/consumers/detail${query({ group: text(p, 'group') })}`,
  }),
  'consumers.stats': (p) => ({
    method: 'GET',
    path: `/v1/consumers/stats${query({ group: text(p, 'group') })}`,
  }),
  'consumers.create': (p) => ({ method: 'POST', path: '/v1/consumers', body: p }),
  'consumers.update': (p) => ({ method: 'PUT', path: '/v1/consumers', body: p }),
  'consumers.remove': (p) => ({
    method: 'DELETE',
    path: `/v1/consumers${query({ group: text(p, 'group'), brokerAddr: text(p, 'brokerAddr') })}`,
  }),
  'consumers.resetOffset': (p) => ({ method: 'POST', path: '/v1/consumers/reset-offset', body: p }),
  'messages.query': (p) => ({ method: 'GET', path: `/v1/messages${query(p)}` }),
  'messages.byId': (p) => ({
    method: 'GET',
    path: `/v1/messages/by-id${query({ topic: text(p, 'topic'), messageId: text(p, 'messageId') })}`,
  }),
  'messages.track': (p) => ({
    method: 'GET',
    path: `/v1/messages/track${query({ topic: text(p, 'topic'), messageId: text(p, 'messageId') })}`,
  }),
  'messages.dlq': (p) => ({ method: 'GET', path: `/v1/messages/dlq${query(p)}` }),
  'messages.retry': (p) => ({ method: 'GET', path: `/v1/messages/retry${query(p)}` }),
  'messages.resend': (p) => ({ method: 'POST', path: '/v1/messages/resend', body: p }),
  'messages.send': (p) => ({ method: 'POST', path: '/v1/messages/send', body: p }),
  'acl.enabled': () => ({ method: 'GET', path: '/v1/acl/enabled' }),
  'acl.version': () => ({ method: 'GET', path: '/v1/acl/version' }),
  'acl.updateAccess': (p) => ({ method: 'PUT', path: '/v1/acl/access-config', body: p }),
  'acl.deleteAccess': (p) => ({
    method: 'DELETE',
    path: `/v1/acl/access-config${query({ accessKey: text(p, 'accessKey') })}`,
  }),
  'acl.updateWhiteAddrs': (p) => ({ method: 'PUT', path: '/v1/acl/global-white-addrs', body: p }),
}

export async function executeBackendCall(
  supervisor: DaemonSupervisor,
  call: BackendCall,
): Promise<unknown> {
  if (!call || typeof call !== 'object' || typeof call.operation !== 'string')
    throw new Error('后端调用参数无效')
  const factory = operations[call.operation]
  if (!factory) throw new Error('不允许的后端操作')
  const payload = call.payload && typeof call.payload === 'object' ? call.payload : {}
  const request = factory(payload)
  return supervisor.request(request.method, request.path, request.body)
}
