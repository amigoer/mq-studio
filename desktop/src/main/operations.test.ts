import { describe, expect, it, vi } from 'vitest'
import type { BackendCall } from '../shared/bridge'
import { executeBackendCall } from './operations'
import type { DaemonSupervisor } from './daemon-supervisor'

function fakeSupervisor() {
  const request = vi.fn().mockResolvedValue({ ok: true })
  return { supervisor: { request } as unknown as DaemonSupervisor, request }
}

describe('executeBackendCall', () => {
  it('only maps allowlisted operations to fixed backend paths', async () => {
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

  it('rejects arbitrary operation names constructed by the renderer', async () => {
    const { supervisor, request } = fakeSupervisor()
    const call = { operation: 'system.exec' } as unknown as BackendCall
    await expect(executeBackendCall(supervisor, call)).rejects.toThrow('backend operation not allowed')
    expect(request).not.toHaveBeenCalled()
  })
})
