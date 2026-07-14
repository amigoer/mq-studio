import type { components } from './schema'

export type AclVersionInfo = components['schemas']['AclVersionInfo']
export type AppSettings = components['schemas']['AppSettings']
export type BrokerNode = components['schemas']['BrokerNode']
export type ClusterInfo = components['schemas']['ClusterInfo']
export type ClusterSummary = components['schemas']['ClusterSummary']
export type Connection = components['schemas']['Connection']
export type ConsumerGroupItem = components['schemas']['ConsumerGroupItem']
export type GroupClient = components['schemas']['GroupClient']
export type GroupSubscription = components['schemas']['GroupSubscription']
export type MessageItem = components['schemas']['MessageItem']
export type MessageTrackItem = components['schemas']['MessageTrackItem']
export type TopicItem = components['schemas']['TopicItem']
export type TopicRouteItem = components['schemas']['TopicRouteItem']

export type BrokerRole = BrokerNode['role']
export type NodeStatus = BrokerNode['status']
export const ConnectionEnv = {
  $zero: '',
  EnvProduction: '生产',
  EnvTest: '测试',
  EnvDevelopment: '开发',
} as const
export type ConnectionEnv = Connection['env']
export const ConnectionStatus = {
  $zero: '',
  StatusOnline: 'online',
  StatusOffline: 'offline',
} as const
export type ConnectionStatus = Connection['status']
export const ConsumeMode = {
  $zero: '',
  ModeClustering: 'CLUSTERING',
  ModeBroadcasting: 'BROADCASTING',
} as const
export type ConsumeMode = ConsumerGroupItem['consumeMode']
export type GroupStatus = ConsumerGroupItem['status']
export type MessageStatus = MessageItem['status']
export const TopicPerm = {
  $zero: '',
  PermRW: 'RW',
  PermR: 'R',
  PermW: 'W',
  PermDeny: 'DENY',
} as const
export type TopicPerm = TopicItem['perm']
export const TopicMessageType = {
  $zero: '',
  MessageTypeNormal: 'Normal',
  MessageTypeFIFO: 'FIFO',
  MessageTypeDelay: 'Delay',
} as const
export type TopicMessageType = TopicItem['messageType']
