/**
 * Domain types for the UI, re-exported from the Wails bindings.
 *
 * The bindings mirror the Go structs one for one, including the Go constant
 * names for enums. This module is the single place that maps them onto the
 * vocabulary the pages use, so a rename on either side stays a one-file change.
 */
import * as model from "@bindings/model/models";
import type {
  ClusterView,
  ConnectionView,
  MaintenanceTaskView,
  SettingsView,
} from "@bindings/bridge/models";

export type AclVersionInfo = model.AclVersionInfo;
export type AccessPrincipal = model.AccessPrincipal;
export type AccessRule = model.AccessRule;
export type AccessPolicy = model.AccessPolicy;
export type Node = model.Node;
export type ClusterOverview = model.ClusterOverview;
/** The cluster page snapshot: header counters plus the nodes behind them. */
export type { ClusterView };
/** One housekeeping job a node can be asked to run, and whether it destroys data. */
export type { MaintenanceTaskView };
export type Destination = model.Destination;
export type Binding = model.Binding;
export type DestinationRef = model.DestinationRef;
export type Subscription = model.Subscription;
export type SubscriptionRef = model.SubscriptionRef;
export type SubscriptionStatus = model.SubscriptionStatus;
export type MessageItem = model.MessageItem;
export type MessageTrackItem = model.MessageTrackItem;
export type ProducerClient = model.ProducerClient;
export type ReplayResult = model.ReplayResult;
export type ResetOffsetRequest = model.ResetOffsetRequest;

/** A connection as the UI sees it: ACL secrets are redacted in Go. */
export type Connection = ConnectionView;
/** Settings as the UI sees it: global ACL secrets are redacted in Go. */
export type AppSettings = SettingsView;

export type NodeStatus = model.NodeStatus;
export type MessageStatus = model.MessageStatus;

/**
 * The enums below re-label the generated members, which carry the Go constant
 * names, with the vocabulary the pages read better in. They stay the same enum
 * values, so they remain assignable to the generated model fields.
 *
 * Topic permissions, message types and consume modes are gone from here. They
 * are RocketMQ's alone, Go no longer sends them across as their own types,
 * and they live under mq/rocketmq/ with the rest of that family's vocabulary.
 */

export const ConnectionStatus = {
  Online: model.ConnectionStatus.StatusOnline,
  Offline: model.ConnectionStatus.StatusOffline,
} as const;
export type ConnectionStatus = model.ConnectionStatus;
