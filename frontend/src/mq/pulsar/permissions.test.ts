import { describe, expect, it } from "vitest";
import { NamespacePermission, TopicPermission } from "@bindings/model/models";
import {
  canConfigure,
  canRead,
  canWrite,
  configurableAt,
  emptyGrantForm,
  grantTopic,
  validateGrant,
} from "./permissions";

const t = (key: string) => key;

const namespaceGrant = (over: Partial<NamespacePermission> = {}) =>
  new NamespacePermission({
    namespace: "public/default",
    identity: "order-service",
    configure: "",
    write: "",
    read: "",
    ...over,
  });

/*
 * A permission is granted only when the driver wrote "allow".
 *
 * An empty string is the driver's "not granted", and reading anything truthy
 * as granted would tell an operator a role can publish when it cannot.
 */
describe("reading a grant", () => {
  it("is false for a permission that was never granted", () => {
    const grant = namespaceGrant();
    expect(canConfigure(grant)).toBe(false);
    expect(canWrite(grant)).toBe(false);
    expect(canRead(grant)).toBe(false);
  });

  it("is true only for allow", () => {
    expect(canWrite(namespaceGrant({ write: "allow" }))).toBe(true);
    expect(canRead(namespaceGrant({ read: "allow" }))).toBe(true);
    expect(canConfigure(namespaceGrant({ configure: "allow" }))).toBe(true);
  });

  it("names the topic a per-topic grant applies to", () => {
    const grant = new TopicPermission({
      namespace: "public/default",
      identity: "audit-tool",
      exchange: "persistent://public/default/orders",
      write: "",
      read: "allow",
    });
    expect(grantTopic(grant)).toBe("persistent://public/default/orders");
    expect(canRead(grant)).toBe(true);
    expect(canWrite(grant)).toBe(false);
  });
});

/*
 * Configure exists only at namespace scope, and that is Pulsar's shape rather
 * than a gap: functions, sinks and packages are deployed into a namespace, not
 * into a topic. Showing the checkbox on a topic grant would offer something
 * the broker would ignore.
 */
describe("where configure applies", () => {
  it("is offered on a namespace grant", () => {
    expect(configurableAt("")).toBe(true);
  });

  it("is not offered on a topic grant", () => {
    expect(configurableAt("persistent://public/default/orders")).toBe(false);
  });
});

/*
 * An empty grant is refused, and this is the rule worth having on both sides.
 *
 * Pulsar's grant replaces a role's whole action list instead of adding to it,
 * so a grant with nothing ticked silently revokes - which is the other button,
 * with its own confirmation.
 */
describe("what the grant form refuses", () => {
  const form = (over = {}) => ({ ...emptyGrantForm(), role: "order-service", ...over });

  it("needs a role", () => {
    expect(validateGrant(form({ role: "", read: true }), t)).toBe(
      "board.acl.pulsar.roleRequired",
    );
    expect(validateGrant(form({ role: "  ", read: true }), t)).toBe(
      "board.acl.pulsar.roleRequired",
    );
  });

  // The role goes straight into a URL path.
  it("refuses a role containing a space", () => {
    expect(validateGrant(form({ role: "order service", read: true }), t)).toBe(
      "board.acl.pulsar.roleInvalid",
    );
  });

  it("refuses a grant with nothing ticked", () => {
    expect(validateGrant(form(), t)).toBe("board.acl.pulsar.nothingGranted");
  });

  /*
   * Configure alone is a real grant at namespace scope and nothing at topic
   * scope, so the same form is valid in one and not the other. Accepting it
   * on a topic would send a grant the broker turns into an empty action list,
   * which revokes.
   */
  it("counts configure only where it means something", () => {
    expect(validateGrant(form({ configure: true }), t)).toBeNull();
    expect(
      validateGrant(
        form({ configure: true, topic: "persistent://public/default/orders" }),
        t,
      ),
    ).toBe("board.acl.pulsar.nothingGranted");
  });

  it("accepts an ordinary grant", () => {
    expect(validateGrant(form({ read: true }), t)).toBeNull();
    expect(validateGrant(form({ write: true, read: true }), t)).toBeNull();
  });
});
