import type { BackendCall, BackendOperation } from '../../shared/bridge'

export function callBackend<T>(
  operation: BackendOperation,
  payload?: Record<string, unknown>,
): Promise<T> {
  const call: BackendCall = payload ? { operation, payload } : { operation }
  return window.rocketLeaf.backend.call<T>(call)
}
