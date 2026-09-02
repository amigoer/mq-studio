/**
 * MQTT's view of the canonical destination.
 *
 * The keys are a contract with internal/driver/mqtt/topics.go.
 *
 * The caveat is the whole point of the source field. MQTT has no topic
 * registry - a topic exists while a message is in flight to it and not
 * otherwise - so the listing answers "which topics hold a retained value"
 * rather than "which topics exist". A device publishing without the retain
 * flag will not appear, and its absence is not a fault.
 */
import type { Destination } from "@bindings/model/models";

const AttrSource = "source";
const AttrRetainedBytes = "retainedBytes";
const AttrQoS = "qos";

/** The listing answered from the broker's retained messages. */
export const SOURCE_RETAINED = "retained";

type Attributed = { attributes?: Record<string, string | undefined> };

function attr(source: Attributed, key: string): string {
  return source.attributes?.[key] ?? "";
}

export interface MqttTopic {
  name: string;
  /** Where this topic came from. Today always the retained set. */
  source: string;
  retainedBytes: number | null;
  qos: number | null;
  /** The topic's levels, for a tree. */
  levels: string[];
}

export function topic(destination: Destination): MqttTopic {
  const name = destination.ref.name;
  const bytes = Number.parseInt(attr(destination, AttrRetainedBytes), 10);
  const qos = Number.parseInt(attr(destination, AttrQoS), 10);
  return {
    name,
    source: attr(destination, AttrSource),
    retainedBytes: Number.isNaN(bytes) ? null : bytes,
    qos: Number.isNaN(qos) ? null : qos,
    levels: name.split("/"),
  };
}

/** One node of a topic tree. */
export interface TopicNode {
  /** The level's own name, without its parents. */
  label: string;
  /** The full topic path down to and including this level. */
  path: string;
  children: TopicNode[];
  /** Set when a topic ends exactly here rather than only passing through. */
  topic?: MqttTopic;
  /** How many topics sit at or below this level. */
  total: number;
}

/**
 * Builds the tree the topic and subscribe boards draw.
 *
 * MQTT topics are a path and nothing else - there is no registry of branches,
 * only the leaves something published to - so the branches are inferred from
 * the leaves. A level with no topic of its own is a branch that exists only
 * because something below it does, which is worth showing as exactly that.
 */
export function topicTree(topics: MqttTopic[]): TopicNode[] {
  const roots: TopicNode[] = [];

  for (const leaf of topics) {
    let level = roots;
    let path = "";
    for (let depth = 0; depth < leaf.levels.length; depth++) {
      // A topic filter can carry an empty level ("a//b" is legal), so the
      // label is taken as given rather than skipped.
      const label = leaf.levels[depth] ?? "";
      path = depth === 0 ? label : `${path}/${label}`;
      const existing = level.find((candidate) => candidate.label === label);
      const node: TopicNode = existing ?? { label, path, children: [], total: 0 };
      if (existing == null) level.push(node);
      node.total += 1;
      if (depth === leaf.levels.length - 1) node.topic = leaf;
      level = node.children;
    }
  }

  const sort = (nodes: TopicNode[]): TopicNode[] => {
    nodes.sort((a, b) => a.label.localeCompare(b.label));
    for (const node of nodes) sort(node.children);
    return nodes;
  };
  return sort(roots);
}
