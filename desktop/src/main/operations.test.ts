import { describe, expect, it, vi } from 'vitest'
import type { BackendCall } from '../shared/bridge'
import { executeBackendCall } from './operations'
import type { DaemonSupervisor } from './daemon-supervisor'

function fakeSupervisor() {
  const request = vi.fn().mockResolvedValue({ ok: true })
  return { supervisor: { request } as unknown as DaemonSupervisor, request }
}

describe('executeBackendCall', () => {
  it('只把白名单操作映射为固定后端路径', async () => {
    const { supervisor, request } = fakeSupervisor()
    await executeBackendCall(supervisor, {
      operation: 'messages.byId',
      payload: { topic: 'a/b', messageId: 'id + 1' },
    })
    expect(request).toHaveBeenCalledWith(
      'GET',
      '/v1/messages/by-id?topic=a%2Fb&messageId=id+%2B+1',
      undefined,
    )
  })

  it('拒绝 Renderer 构造的任意操作名', async () => {
    const { supervisor, request } = fakeSupervisor()
    const call = { operation: 'system.exec' } as unknown as BackendCall
    await expect(executeBackendCall(supervisor, call)).rejects.toThrow('不允许的后端操作')
    expect(request).not.toHaveBeenCalled()
  })
})
