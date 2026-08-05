/**
 * Domain types for the UI, re-exported from the Wails bindings.
 *
 * The bindings mirror the Go structs one for one, including the Go constant
 * names for enums. This module is the single place that maps them onto the
 * vocabulary the pages use, so a rename on either side stays a one-file change.
 */
import * as model from '@bindings/model/models'
import type { ConnectionView, SettingsView } from '@bindings/bridge/models'

export type AclVersionInfo = model.AclVersionInfo
export type BrokerNode = model.BrokerNode
export type ClusterInfo = model.ClusterInfo
export type ClusterSummary = model.ClusterSummary
export type ConsumerGroupItem = model.ConsumerGroupItem
export type GroupClient = model.GroupClient
export type GroupSubscription = model.GroupSubscription
export type MessageItem = model.MessageItem
export type MessageTrackItem = model.MessageTrackItem
export type ResetOffsetRequest = model.ResetOffsetRequest
export type TopicItem = model.TopicItem
export type TopicRouteItem = model.TopicRouteItem

/** A connection as the UI sees it: ACL secrets are redacted in Go. */
export type Connection = ConnectionView
/** Settings as the UI sees it: global ACL secrets are redacted in Go. */
export type AppSettings = SettingsView

export type BrokerRole = model.BrokerRole
export type NodeStatus = model.NodeStatus
export type GroupStatus = model.GroupStatus
export type MessageStatus = model.MessageStatus

/**
 * The enums below re-label the generated members, which carry the Go constant
 * names, with the vocabulary the pages read better in. They stay the same enum
 * values, so they remain assignable to the generated model fields.
 */

export const ConnectionStatus = {
  Online: model.ConnectionStatus.StatusOnline,
  Offline: model.ConnectionStatus.StatusOffline,
} as const
export type ConnectionStatus = model.ConnectionStatus

export const ConsumeMode = {
  Clustering: model.ConsumeMode.ModeClustering,
  Broadcasting: model.ConsumeMode.ModeBroadcasting,
} as const
export type ConsumeMode = model.ConsumeMode

export const TopicPerm = {
  ReadWrite: model.TopicPerm.PermRW,
  ReadOnly: model.TopicPerm.PermR,
  WriteOnly: model.TopicPerm.PermW,
  Deny: model.TopicPerm.PermDeny,
} as const
export type TopicPerm = model.TopicPerm

export const TopicMessageType = {
  Normal: model.TopicMessageType.MessageTypeNormal,
  FIFO: model.TopicMessageType.MessageTypeFIFO,
  Delay: model.TopicMessageType.MessageTypeDelay,
} as const
export type TopicMessageType = model.TopicMessageType
