/**
 * Pulsar's view of the canonical namespace model.
 *
 * The limit keys are a contract with internal/driver/pulsar/namespace.go.
 *
 * What is absent matters as much as what is here. model.Namespace was shaped
 * for a RabbitMQ virtual host, so it carries a description, tags, a default
 * queue type and a tracing switch - Pulsar has none of them, and this module
 * exposes none of them either. What it does carry that Pulsar means is the
 * name and the limit map.
 *
 * A limit absent from the map is uncapped, which is Pulsar's own default and
 * is not the same as a limit of zero: zero producers is a namespace nothing
 * can publish to.
 */
import type { Namespace } from "@bindings/model/models";

export const LimitMessageTTLSeconds = "messageTtlSeconds";
export const LimitRetentionTimeMinutes = "retentionTimeMinutes";
export const LimitRetentionSizeMB = "retentionSizeMb";
export const LimitMaxProducersPerTopic = "maxProducersPerTopic";
export const LimitMaxConsumersPerTopic = "maxConsumersPerTopic";
export const LimitMaxConsumersPerSubscription = "maxConsumersPerSubscription";

/** Every limit the form can set, in the order it draws them. */
export const NAMESPACE_LIMITS = [
  LimitMessageTTLSeconds,
  LimitRetentionTimeMinutes,
  LimitRetentionSizeMB,
  LimitMaxProducersPerTopic,
  LimitMaxConsumersPerTopic,
  LimitMaxConsumersPerSubscription,
] as const;

export type NamespaceLimit = (typeof NAMESPACE_LIMITS)[number];

/**
 * One limit's value, or null when the broker decides.
 *
 * The null is the whole reason this is a function rather than an index: a
 * limit read as 0 because it was absent tells an operator the namespace is
 * capped at nothing, which is the opposite of what an absent limit means.
 */
export function limit(namespace: Namespace, key: string): number | null {
  const value = namespace.limits?.[key];
  return value == null ? null : value;
}

/** How many limits are set on this namespace, for a list column. */
export function limitCount(namespace: Namespace): number {
  return NAMESPACE_LIMITS.filter((key) => limit(namespace, key) != null).length;
}

/** The tenant half of a "tenant/namespace" name. */
export function tenantOf(namespace: Namespace): string {
  const [tenant] = namespace.name.split("/");
  return tenant ?? "";
}

/** The namespace half, which is what a list column shows. */
export function shortNameOf(namespace: Namespace): string {
  const parts = namespace.name.split("/");
  return parts.length > 1 ? parts.slice(1).join("/") : namespace.name;
}

/**
 * Whether a name the form collected can be created.
 *
 * Pulsar refuses a namespace name with a slash in it - the slash is what
 * separates it from its tenant - and refuses an empty one. Both are caught
 * here so the message names the field rather than arriving as a 412 from the
 * broker with Pulsar's own wording.
 */
export function validateName(name: string, t: (key: string) => string): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return t("board.vhosts.pulsar.nameRequired");
  if (trimmed.includes("/")) return t("board.vhosts.pulsar.nameSlash");
  // Pulsar allows letters, digits, hyphens, underscores and dots. Anything
  // else comes back as a 412 that names no field.
  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) return t("board.vhosts.pulsar.nameInvalid");
  return null;
}
