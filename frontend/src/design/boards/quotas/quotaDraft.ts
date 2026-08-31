/**
 * What the quota form collects, and what it will not send.
 *
 * Beside the dialog rather than inside it because these rules are the part
 * worth testing, and a component module drags the whole shell in with it.
 */
import type { ClientQuota, QuotaEntity } from "@bindings/model/models";

export interface QuotaEntityDraft {
  type: string;
  name: string;
  /** The fallback every client of this type with no quota of their own gets. */
  isDefault: boolean;
}

export interface QuotaDraft {
  entity: QuotaEntityDraft[];
  /** Limit keys to values, as typed. Blank means "leave it alone". */
  limits: Record<string, string>;
}

export function emptyQuotaDraft(limits: readonly string[]): QuotaDraft {
  const blank: Record<string, string> = {};
  for (const key of limits) blank[key] = "";
  return { entity: [{ type: "user", name: "", isDefault: false }], limits: blank };
}

/**
 * Kafka's own rule about the dimensions.
 *
 * A user quota and a client-id quota compose - "this application, run by this
 * user" is a real limit. An IP quota does not compose with either: it throttles
 * connections before anybody has authenticated, so there is no identity to
 * combine it with, and Kafka answers INVALID_REQUEST rather than explaining.
 */
export function entityCombinationIsValid(entity: readonly QuotaEntityDraft[]): boolean {
  const hasIP = entity.some((one) => one.type === "ip");
  const hasIdentity = entity.some((one) => one.type === "user" || one.type === "client-id");
  return !(hasIP && hasIdentity);
}

export function validateQuotaDraft(draft: QuotaDraft): string | null {
  if (draft.entity.length === 0) return "entityRequired";
  for (const one of draft.entity) {
    // A named entity with no name is a row nothing matches; the default
    // switch is how an operator asks for the fallback.
    if (!one.isDefault && one.name.trim() === "") return "nameRequired";
  }
  if (new Set(draft.entity.map((one) => one.type)).size !== draft.entity.length) {
    return "duplicateType";
  }
  if (!entityCombinationIsValid(draft.entity)) return "ipCombination";

  let any = false;
  for (const value of Object.values(draft.limits)) {
    if (value.trim() === "") continue;
    any = true;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return "limitInvalid";
  }
  if (!any) return "limitRequired";
  return null;
}

/** The entity as the bridge takes it. */
export function toQuotaEntity(draft: QuotaDraft): QuotaEntity[] {
  return draft.entity.map((one) => ({
    type: one.type,
    name: one.isDefault ? "" : one.name.trim(),
    default: one.isDefault,
  })) as QuotaEntity[];
}

/** The limits that were typed. A blank field is left alone, not set to zero. */
export function toQuotaLimits(draft: QuotaDraft): Record<string, number> {
  const set: Record<string, number> = {};
  for (const [key, value] of Object.entries(draft.limits)) {
    if (value.trim() === "") continue;
    set[key] = Number(value);
  }
  return set;
}

/** How a quota's identity reads on the page, and its key for matching a row. */
export function quotaLabel(quota: ClientQuota): string {
  return (quota.entity ?? [])
    .filter((one): one is NonNullable<typeof one> => one != null)
    .map((one) => `${one.type}=${one.default ? "<default>" : one.name}`)
    .join(", ");
}

/** Every limit key a quota carries, sorted so a row does not reshuffle. */
export function quotaLimitKeys(quota: ClientQuota): string[] {
  return Object.keys(quota.limits ?? {}).sort();
}
