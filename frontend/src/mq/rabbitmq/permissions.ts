/**
 * RabbitMQ's two access systems, as data.
 *
 * They are two and not one, and this file exists mostly to keep that straight.
 * A user's tags decide what the management API lets it do; its per-virtual-host
 * permissions decide what its AMQP connections may touch. A user with every tag
 * and no permission can read every page and open no queue.
 */
import type { Identity, NamespacePermission } from "@/api/rabbitmq";

/**
 * The tags the broker itself acts on. Anything else is a label the operator
 * invented, which RabbitMQ stores and ignores.
 */
export const KNOWN_TAGS = [
  "administrator",
  "monitoring",
  "policymaker",
  "management",
] as const;

/** Patterns that come up often enough to offer as one click. */
export const PATTERN_ALL = ".*";
export const PATTERN_NONE = "";

/**
 * What a permission pattern actually does, in three states rather than two.
 *
 * The distinction is the whole model and is easy to lose: an empty pattern
 * matches nothing and permits nothing, ".*" matches everything, and anything
 * else is a real expression the reader has to look at. A page that showed
 * empty as "not set" would be describing the opposite of what it does.
 */
export type PatternKind = "none" | "all" | "pattern";

export function patternKind(pattern: string): PatternKind {
  if (pattern === PATTERN_NONE) return "none";
  if (pattern === PATTERN_ALL) return "all";
  return "pattern";
}

/** Whether this permission grants anything at all. */
export function grantsNothing(permission: NamespacePermission): boolean {
  return (
    permission.configure === PATTERN_NONE &&
    permission.write === PATTERN_NONE &&
    permission.read === PATTERN_NONE
  );
}

/** Whether this permission grants everything in its virtual host. */
export function grantsEverything(permission: NamespacePermission): boolean {
  return (
    permission.configure === PATTERN_ALL &&
    permission.write === PATTERN_ALL &&
    permission.read === PATTERN_ALL
  );
}

/**
 * Whether a user can reach the broker at all through AMQP.
 *
 * A user with no permission record anywhere is refused by the broker on every
 * virtual host, which looks from the application side like a wrong password.
 * It is worth calling out on the row rather than leaving someone to notice the
 * empty permission list.
 */
export function hasNoAccess(identity: Identity): boolean {
  const permissions = identity.permissions ?? [];
  return permissions.length === 0 || permissions.every((p) => p != null && grantsNothing(p));
}

/**
 * Whether a user can administer the broker.
 *
 * The administrator tag is the one worth flagging: it grants every management
 * operation on every virtual host regardless of permissions.
 */
export function isAdministrator(identity: Identity): boolean {
  return (identity.tags ?? []).includes("administrator");
}

/**
 * Whether the user can reach the management API at all.
 *
 * Without one of these tags the credential works for AMQP and every page in
 * this app fails, which is a confusing failure worth naming on the row.
 */
export function canManage(identity: Identity): boolean {
  const tags = identity.tags ?? [];
  return tags.some((tag) => KNOWN_TAGS.includes(tag as (typeof KNOWN_TAGS)[number]));
}
