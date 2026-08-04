import { ClusterService } from '@bindings/bridge'
import type { BrokerNode, ClusterInfo, ClusterSummary } from './models'
import { present, required } from './client'

export const getBrokers = (): Promise<BrokerNode[]> => ClusterService.Brokers().then(present)
export const getClusterInfo = (): Promise<ClusterInfo> => ClusterService.Info().then(required)
export const getClusterSummary = (): Promise<ClusterSummary> =>
  ClusterService.Summary().then(required)
export const getBrokerDetail = (brokerAddr: string): Promise<BrokerNode> =>
  ClusterService.BrokerDetail(brokerAddr).then(required)
