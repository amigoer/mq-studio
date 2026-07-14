import type { BrokerNode, ClusterInfo, ClusterSummary } from '@generated/models'
import { callBackend } from './client'

export const getBrokers = (): Promise<BrokerNode[]> => callBackend('cluster.brokers')
export const getClusterInfo = (): Promise<ClusterInfo> => callBackend('cluster.info')
export const getClusterSummary = (): Promise<ClusterSummary> => callBackend('cluster.summary')
export const getBrokerDetail = (brokerAddr: string): Promise<BrokerNode> =>
  callBackend('cluster.brokerDetail', { brokerAddr })
