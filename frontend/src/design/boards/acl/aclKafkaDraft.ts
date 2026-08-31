/**
 * What the Kafka ACL and user forms collect, and what they will not send.
 *
 * Beside the dialogs rather than inside them because these rules are the part
 * worth testing, and a component module drags the whole shell in with it.
 */

/** One grant: a resource, some operations, and whether they are allowed. */
export interface AclPolicyDraft {
  /** topic, group, cluster or transactionalId. */
  kind: string;
  /** The resource name. Ignored for cluster, which names itself. */
  name: string;
  /** A prefixed pattern covers every name starting with this one. */
  prefixed: boolean;
  operations: string[];
  effect: "Allow" | "Deny";
  /** Empty means from anywhere, which is Kafka's own default. */
  host: string;
}

export interface AclRuleDraft {
  subject: string;
  policies: AclPolicyDraft[];
}

export function emptyAclPolicyDraft(): AclPolicyDraft {
  return { kind: "topic", name: "", prefixed: false, operations: [], effect: "Allow", host: "" };
}

export function emptyAclRuleDraft(): AclRuleDraft {
  return { subject: "", policies: [emptyAclPolicyDraft()] };
}

/**
 * A principal is a type and a name, and Kafka stores both.
 *
 * "alice" is not a principal; "User:alice" is. A form that accepted the first
 * would write a rule the cluster keeps and nothing ever matches, which is the
 * worst kind of ACL mistake: it looks applied and grants nothing.
 */
const PRINCIPAL = /^[A-Za-z]+:.+$/;

export function validateAclRuleDraft(draft: AclRuleDraft): string | null {
  if (draft.subject.trim() === "") return "subjectRequired";
  if (!PRINCIPAL.test(draft.subject.trim())) return "subjectShape";
  if (draft.policies.length === 0) return "policyRequired";

  for (const policy of draft.policies) {
    if (policy.operations.length === 0) return "operationRequired";
    // Cluster names itself; everything else needs a name to match.
    if (policy.kind !== "cluster" && policy.name.trim() === "") return "nameRequired";
    // A prefixed pattern of nothing matches every resource of that kind,
    // which is almost never what someone meant to type.
    if (policy.prefixed && policy.name.trim() === "") return "prefixEmpty";
  }
  return null;
}

/** The draft as the bridge takes it. */
export function toAccessRule(draft: AclRuleDraft) {
  return {
    subject: draft.subject.trim(),
    description: "",
    policies: draft.policies.map((policy) => ({
      resource: resourceOf(policy),
      actions: policy.operations,
      effect: policy.effect,
      sourceIps: policy.host.trim() === "" ? [] : [policy.host.trim()],
      decision: "",
    })),
  };
}

/**
 * The resource string the driver parses back.
 *
 * A prefixed pattern keeps a trailing star, because "topic:orders" and
 * "topic:orders*" are different rules and must not read the same.
 */
export function resourceOf(policy: AclPolicyDraft): string {
  if (policy.kind === "cluster") return "cluster";
  const name = policy.name.trim();
  return `${policy.kind}:${name}${policy.prefixed ? "*" : ""}`;
}

/** What the SCRAM user form collects. */
export interface ScramUserDraft {
  name: string;
  password: string;
  mechanism: string;
}

export function emptyScramUserDraft(): ScramUserDraft {
  return { name: "", password: "", mechanism: "SCRAM-SHA-512" };
}

export function validateScramUserDraft(draft: ScramUserDraft): string | null {
  if (draft.name.trim() === "") return "nameRequired";
  // The name is stored as the principal's name, so a colon in it would make
  // "User:a:b" - a principal nothing can match.
  if (draft.name.includes(":")) return "nameColon";
  // Kafka stores the password salted and cannot be asked for it again, so
  // there is no such thing as leaving it blank to keep the old one.
  if (draft.password === "") return "passwordRequired";
  return null;
}

export function toPrincipalSpec(draft: ScramUserDraft) {
  return {
    name: draft.name.trim(),
    secret: draft.password,
    type: draft.mechanism,
    status: "enabled",
  };
}
