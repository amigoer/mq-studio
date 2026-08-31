import { describe, expect, it } from "vitest";
import {
  emptyAclPolicyDraft,
  emptyAclRuleDraft,
  emptyScramUserDraft,
  resourceOf,
  toAccessRule,
  toPrincipalSpec,
  validateAclRuleDraft,
  validateScramUserDraft,
  type AclPolicyDraft,
  type AclRuleDraft,
} from "./aclKafkaDraft";

const policy = (over: Partial<AclPolicyDraft> = {}): AclPolicyDraft => ({
  ...emptyAclPolicyDraft(),
  name: "orders",
  operations: ["READ"],
  ...over,
});

const rule = (over: Partial<AclRuleDraft> = {}): AclRuleDraft => ({
  ...emptyAclRuleDraft(),
  subject: "User:alice",
  policies: [policy()],
  ...over,
});

/*
 * "alice" is not a principal; "User:alice" is. A form that accepted the first
 * would write a rule the cluster stores and nothing ever matches - the worst
 * kind of ACL mistake, because it looks applied and grants nothing.
 */
describe("the principal", () => {
  it("needs a type and a name", () => {
    expect(validateAclRuleDraft(rule({ subject: "User:alice" }))).toBeNull();
    expect(validateAclRuleDraft(rule({ subject: "Group:admins" }))).toBeNull();
  });

  it("refuses a bare name", () => {
    expect(validateAclRuleDraft(rule({ subject: "alice" }))).toBe("subjectShape");
    expect(validateAclRuleDraft(rule({ subject: "User:" }))).toBe("subjectShape");
    expect(validateAclRuleDraft(rule({ subject: "" }))).toBe("subjectRequired");
  });
});

describe("a grant", () => {
  it("needs at least one operation", () => {
    expect(validateAclRuleDraft(rule({ policies: [policy({ operations: [] })] })))
      .toBe("operationRequired");
  });

  it("needs a resource name for everything but the cluster", () => {
    expect(validateAclRuleDraft(rule({ policies: [policy({ name: "" })] }))).toBe("nameRequired");
    expect(validateAclRuleDraft(rule({ policies: [policy({ kind: "cluster", name: "" })] })))
      .toBeNull();
  });

  // A prefix of nothing matches every resource of that kind, which is almost
  // never what someone meant to type.
  it("refuses an empty prefix", () => {
    expect(validateAclRuleDraft(rule({ policies: [policy({ prefixed: true, name: "" })] })))
      .toBe("nameRequired");
  });
});

/*
 * A prefixed pattern keeps its star, because "topic:orders" and
 * "topic:orders*" are different rules on the cluster and must not read alike.
 */
describe("the resource string", () => {
  it("names the kind so two resources cannot be confused", () => {
    expect(resourceOf(policy({ kind: "topic", name: "orders" }))).toBe("topic:orders");
    expect(resourceOf(policy({ kind: "group", name: "orders" }))).toBe("group:orders");
  });

  it("keeps a trailing star on a prefix", () => {
    expect(resourceOf(policy({ kind: "topic", name: "orders", prefixed: true })))
      .toBe("topic:orders*");
  });

  it("lets the cluster name itself", () => {
    expect(resourceOf(policy({ kind: "cluster", name: "ignored" }))).toBe("cluster");
  });
});

describe("the submitted rule", () => {
  it("carries every grant with its effect", () => {
    const submitted = toAccessRule(
      rule({
        policies: [
          policy({ operations: ["READ", "DESCRIBE"] }),
          policy({ kind: "group", name: "g1", effect: "Deny", host: "10.0.0.1" }),
        ],
      }),
    );

    expect(submitted.subject).toBe("User:alice");
    expect(submitted.policies).toHaveLength(2);
    expect(submitted.policies[0]).toMatchObject({
      resource: "topic:orders",
      actions: ["READ", "DESCRIBE"],
      effect: "Allow",
      sourceIps: [],
    });
    expect(submitted.policies[1]).toMatchObject({
      resource: "group:g1",
      effect: "Deny",
      sourceIps: ["10.0.0.1"],
    });
  });

  // Empty means from anywhere, which is Kafka's own default. Sending an empty
  // string as a host would store a rule nothing matches.
  it("sends no host at all when none was given", () => {
    expect(toAccessRule(rule()).policies[0]!.sourceIps).toEqual([]);
  });
});

describe("the SCRAM user form", () => {
  const user = (over = {}) => ({ ...emptyScramUserDraft(), name: "alice", password: "p", ...over });

  it("needs a name and a password", () => {
    expect(validateScramUserDraft(user())).toBeNull();
    expect(validateScramUserDraft(user({ name: "" }))).toBe("nameRequired");
    expect(validateScramUserDraft(user({ password: "" }))).toBe("passwordRequired");
  });

  // The name becomes the principal's name, so a colon would make "User:a:b" -
  // a principal nothing can match.
  it("refuses a colon in the name", () => {
    expect(validateScramUserDraft(user({ name: "User:alice" }))).toBe("nameColon");
  });

  it("carries the mechanism, which is a separate credential on the broker", () => {
    expect(toPrincipalSpec(user({ mechanism: "SCRAM-SHA-256" })).type).toBe("SCRAM-SHA-256");
    expect(toPrincipalSpec(user()).type).toBe("SCRAM-SHA-512");
  });
});
