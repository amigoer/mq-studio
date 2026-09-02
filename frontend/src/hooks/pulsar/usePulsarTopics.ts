import { useCallback } from "react";
import {
  getPulsarTopicDetail,
  getPulsarTopicStats,
  getPulsarTopics,
  type Destination,
} from "@/api/pulsar";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";

/**
 * Every topic in one namespace.
 *
 * The namespace is a parameter rather than the connection's own, because the
 * topics page cascades: a Pulsar topic is addressed as tenant/namespace/name,
 * so choosing a namespace is how the page is scoped at all. Blank falls back
 * to the connection's, which is what the page opens on.
 */
export function usePulsarTopics(namespace: string): BrokerData<Destination[]> {
  return useBrokerData(
    useCallback((connID: number) => getPulsarTopics(connID, namespace), [namespace]),
  );
}

/** One topic's per-partition breakdown, read only while its panel is open. */
export function usePulsarTopicDetail(
  namespace: string,
  name: string | null,
): BrokerData<PulsarTopicDetail> {
  return useBrokerData(
    useCallback(
      async (connID: number) => {
        if (name == null) throw new Error("no topic selected");
        const [topic, stats] = await Promise.all([
          getPulsarTopicDetail(connID, namespace, name),
          getPulsarTopicStats(connID, namespace, name),
        ]);
        return { topic, partitions: partitionsOf(stats) };
      },
      [namespace, name],
    ),
    { enabled: name != null, refreshMs: null },
  );
}

export interface PulsarPartition {
  name: string;
  backlog: number | null;
  storageSize: number | null;
  producers: number | null;
  subscriptions: number | null;
}

export interface PulsarTopicDetail {
  topic: Destination;
  partitions: PulsarPartition[];
}

/**
 * The per-partition rows out of the driver's stats document.
 *
 * The document is map[string]interface{} across the bridge, so every field
 * arrives as unknown and has to be read defensively - not because the driver
 * is unreliable, but because a version of it that stops sending one field
 * should leave a blank cell rather than throw on the whole panel.
 */
function partitionsOf(stats: Record<string, unknown>): PulsarPartition[] {
  const raw = stats["partitions"];
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const partition = entry as Record<string, unknown>;
    return {
      name: typeof partition["name"] === "string" ? partition["name"] : "",
      backlog: numberOf(partition["backlog"]),
      storageSize: numberOf(partition["storageSize"]),
      producers: numberOf(partition["producers"]),
      subscriptions: numberOf(partition["subscriptions"]),
    };
  });
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}
