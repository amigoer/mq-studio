import type { RocketLeafBridge } from '../shared/bridge'

declare global {
  interface Window {
    rocketLeaf: RocketLeafBridge
  }
}

export {}
