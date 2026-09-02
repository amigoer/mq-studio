/**
 * Pulsar's view of the canonical permission model.
 *
 * Pulsar authorises a *role*, not a user. The role is the token's subject, and
 * the cluster keeps no directory of them: a grant may name a role that does
 * not exist yet and is honoured the moment a token carrying it turns up. That
 * is why the page is called Tokens and lists grants rather than accounts, and
 * why there is no "create a user" anywhere on it.
 *
 * Pulsar's six actions fold onto the model's three. produce is write and
 * consume is read; functions, sources, sinks and packages are all "may deploy
 * things into this namespace", which is what Configure means. The fold is
 * deliberately lossy when granting - Configure grants all four, rather than
 * asking an operator to reason about four checkboxes for one idea - and exact
 * when reading back.
 */
import type { NamespacePermission, TopicPermission } from "@bindings/model/models";

/** What the driver writes for a permission that is granted. */
const ALLOW = "allow";

export const canConfigure = (permission: NamespacePermission): boolean =>
  permission.configure === ALLOW;
export const canWrite = (permission: NamespacePermission | TopicPermission): boolean =>
  permission.write === ALLOW;
export const canRead = (permission: NamespacePermission | TopicPermission): boolean =>
  permission.read === ALLOW;

/** The topic a per-topic grant applies to. */
export const grantTopic = (permission: TopicPermission): string => permission.exchange;

export interface PulsarGrantForm {
  role: string;
  /** Blank grants the whole namespace; a topic URL narrows it. */
  topic: string;
  configure: boolean;
  write: boolean;
  read: boolean;
}

export function emptyGrantForm(): PulsarGrantForm {
  return { role: "", topic: "", configure: false, write: false, read: false };
}

/**
 * The reason a grant cannot be saved, or null.
 *
 * The empty grant is the one worth catching here rather than in Go: Pulsar's
 * grant replaces a role's whole action list instead of adding to it, so a
 * grant with nothing ticked silently revokes - which is a different button
 * with its own confirmation.
 */
export function validateGrant(
  form: PulsarGrantForm,
  t: (key: string) => string,
): string | null {
  if (form.role.trim() === "") return t("board.acl.pulsar.roleRequired");
  if (/\s/.test(form.role.trim())) return t("board.acl.pulsar.roleInvalid");

  const configure = form.topic === "" && form.configure;
  if (!configure && !form.write && !form.read) {
    return t("board.acl.pulsar.nothingGranted");
  }
  return null;
}

/**
 * Whether a grant would deploy as well as read and write.
 *
 * Only meaningful on a namespace: functions, sinks and packages are deployed
 * into a namespace and not into a topic, so a topic grant has no Configure and
 * the form hides the checkbox rather than showing one that does nothing.
 */
export const configurableAt = (topic: string): boolean => topic === "";
