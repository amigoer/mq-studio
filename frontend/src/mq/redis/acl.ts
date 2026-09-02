/**
 * Redis's access control, as the page reads it.
 *
 * Redis puts everything on the user: what it may run, which keys it may touch,
 * which channels it may subscribe to. None of it is rewritten here - the rule
 * language has more forms than a UI can model, and a permission that changed
 * meaning on its way to the screen is worse than one shown in the server's own
 * words.
 */
import type { AclUser } from "@bindings/model/models";

export const userName = (user: AclUser): string => user.name;
export const enabled = (user: AclUser): boolean => user.enabled;

/** The whole rule as the server stated it, which is what an operator checks. */
export const ruleLine = (user: AclUser): string => user.rule;

export const keyPatterns = (user: AclUser): string[] => user.keyPatterns ?? [];
export const channelPatterns = (user: AclUser): string[] => user.channelPatterns ?? [];
export const commandRules = (user: AclUser): string => user.commandRules;
export const selectors = (user: AclUser): string[] => user.selectors ?? [];

/**
 * How a user authenticates.
 *
 * The three are genuinely different and the middle one is the dangerous one:
 * "any" accepts every password including none, "none" means the user exists
 * and cannot log in at all, and confusing them is how a server is left open.
 */
export type AuthMode = "password" | "any" | "none";

export function authMode(user: AclUser): AuthMode {
  if (user.noPassword) return "any";
  return user.passwordCount > 0 ? "password" : "none";
}

export const passwordCount = (user: AclUser): number => user.passwordCount;

/**
 * Whether this user can reach every key in the database.
 *
 * It is the one thing worth pulling out of the pattern list, because it is the
 * difference between an account scoped to its own data and one that can read
 * and overwrite everything on the server.
 */
export function reachesEveryKey(user: AclUser): boolean {
  return keyPatterns(user).some((pattern) => pattern === "allkeys" || pattern === "~*");
}

/**
 * Whether this user may run everything.
 *
 * Read off the rule text rather than computed: the language allows +@all
 * followed by exclusions, and deciding what a rule adds up to is the server's
 * job. What this answers is the narrower question of whether the grant starts
 * from everything, which is what a reader scans the column for.
 */
export function grantsEveryCommand(user: AclUser): boolean {
  const rules = commandRules(user).split(/\s+/).filter((rule) => rule !== "");
  return rules.length > 0 && rules[rules.length - 1] === "+@all";
}

/** The default user, which cannot be removed and gates anonymous access. */
export const isDefaultUser = (user: AclUser): boolean => user.name === "default";

/**
 * Whether anonymous clients can use this server.
 *
 * A default user that is on and accepts any password is what makes a Redis
 * reachable without credentials, and it is the single most consequential row
 * on the page.
 */
export function allowsAnonymousAccess(users: readonly AclUser[]): boolean {
  const fallback = users.find(isDefaultUser);
  return fallback != null && fallback.enabled && fallback.noPassword;
}
