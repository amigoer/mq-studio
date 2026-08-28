/**
 * RocketMQ's view of a canonical node.
 *
 * The keys are a contract with internal/driver/rocketmq/cluster.go.
 */
import type { Node } from "@bindings/model/models";

const AttrRole = "role";
const AttrBrokerID = "brokerId";
const AttrHAAddress = "haAddress";
const AttrTopics = "topics";
const AttrGroups = "groups";
const AttrMsgInToday = "msgInToday";
const AttrMsgOutToday = "msgOutToday";
const AttrConsumeQueueDiskUsage = "consumeQueueDiskUsage";
const AttrRemark = "remark";

export const BrokerRole = {
  Master: "MASTER",
  Slave: "SLAVE",
} as const;
export type BrokerRole = (typeof BrokerRole)[keyof typeof BrokerRole];

function attr(node: Node, key: string): string {
  return node.attributes?.[key] ?? "";
}

function numeric(node: Node, key: string, fallback = -1): number {
  const value = Number.parseInt(attr(node, key), 10);
  return Number.isNaN(value) ? fallback : value;
}

export const brokerName = (node: Node): string => node.name;
export const brokerId = (node: Node): number => numeric(node, AttrBrokerID, 0);
export const role = (node: Node): BrokerRole =>
  (attr(node, AttrRole) || BrokerRole.Master) as BrokerRole;
export const haAddress = (node: Node): string => attr(node, AttrHAAddress);
export const topicCount = (node: Node): number => numeric(node, AttrTopics);
export const groupCount = (node: Node): number => numeric(node, AttrGroups);
export const msgInToday = (node: Node): number =>
  numeric(node, AttrMsgInToday, 0);
export const msgOutToday = (node: Node): number =>
  numeric(node, AttrMsgOutToday, 0);
export const remark = (node: Node): string => attr(node, AttrRemark);

/**
 * CommitLog usage is the canonical disk figure because it is what the disk
 * alert watches; the consume queue rides along as an attribute.
 */
export const commitLogDiskUsage = (node: Node): number => node.diskUsage;
export const consumeQueueDiskUsage = (node: Node): number =>
  numeric(node, AttrConsumeQueueDiskUsage);
