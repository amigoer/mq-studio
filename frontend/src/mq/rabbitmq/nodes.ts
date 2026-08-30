/**
 * RabbitMQ's view of a canonical node.
 *
 * The keys are a contract with internal/driver/rabbitmq/cluster.go.
 *
 * What is absent matters as much as what is here. There is no per-node
 * throughput: RabbitMQ reports rates for the broker as a whole and for each
 * queue, never for the node holding them, so the canonical rate fields carry
 * the unknown sentinel and no page draws a per-node figure.
 */
import type { Node } from "@bindings/model/models";

const AttrNodeType = "nodeType";
const AttrSchedulers = "schedulers";
const AttrErlangProcs = "erlangProcesses";
const AttrErlangProcMax = "erlangProcessLimit";
const AttrUptime = "uptime";
const AttrFdUsed = "fileDescriptorsUsed";
const AttrFdLimit = "fileDescriptorLimit";
const AttrMemUsed = "memoryUsed";
const AttrMemLimit = "memoryLimit";
const AttrMemAlarm = "memoryAlarm";
const AttrDiskFree = "diskFree";
const AttrDiskLimit = "diskFreeLimit";
const AttrDiskAlarm = "diskFreeAlarm";
const AttrPartitions = "partitions";
const AttrRunQueue = "runQueue";

function attr(node: Node, key: string): string {
  return node.attributes?.[key] ?? "";
}

function count(node: Node, key: string): number {
  const value = Number.parseInt(attr(node, key), 10);
  return Number.isNaN(value) ? 0 : value;
}

export const nodeName = (node: Node): string => node.name;
export const nodeType = (node: Node): string => attr(node, AttrNodeType);
export const schedulers = (node: Node): number => count(node, AttrSchedulers);
export const erlangProcesses = (node: Node): number => count(node, AttrErlangProcs);
export const erlangProcessLimit = (node: Node): number => count(node, AttrErlangProcMax);
export const uptimeMs = (node: Node): number => count(node, AttrUptime);
export const fileDescriptorsUsed = (node: Node): number => count(node, AttrFdUsed);
export const fileDescriptorLimit = (node: Node): number => count(node, AttrFdLimit);
export const memoryUsed = (node: Node): number => count(node, AttrMemUsed);
export const memoryLimit = (node: Node): number => count(node, AttrMemLimit);
export const memoryAlarm = (node: Node): boolean => attr(node, AttrMemAlarm) === "true";
export const diskFree = (node: Node): number => count(node, AttrDiskFree);
export const diskFreeLimit = (node: Node): number => count(node, AttrDiskLimit);
export const diskFreeAlarm = (node: Node): boolean => attr(node, AttrDiskAlarm) === "true";
export const runQueue = (node: Node): number => count(node, AttrRunQueue);

/**
 * The nodes this one thinks it has lost contact with.
 *
 * A non-empty list is a split brain, and it is the single most important thing
 * a RabbitMQ node can be saying: the cluster is running as two halves that
 * each believe they are whole.
 */
export function partitions(node: Node): string[] {
  const raw = attr(node, AttrPartitions);
  return raw === "" ? [] : raw.split(",");
}

/**
 * Memory used as a fraction of the node's own high watermark.
 *
 * This is a real percentage, unlike disk: the broker knows the limit it will
 * alarm at and how much it is using against it. Crossing it blocks publishers
 * rather than killing the node, which is why it is worth a meter.
 */
export function memoryUsage(node: Node): number | null {
  const limit = memoryLimit(node);
  if (limit <= 0) return null;
  return Math.min(100, Math.round((memoryUsed(node) / limit) * 100));
}

/**
 * How close free disk is to the threshold that blocks publishers.
 *
 * Deliberately not "disk used": RabbitMQ never reports the size of the disk,
 * only how much is free and the floor it alarms at. 100 means sitting on the
 * limit; 0 means comfortably above it. Rendering this as disk usage would be
 * a number nobody measured.
 */
export function diskHeadroomUsage(node: Node): number | null {
  const limit = diskFreeLimit(node);
  const free = diskFree(node);
  if (limit <= 0 || free <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((limit / free) * 100)));
}
