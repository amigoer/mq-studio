import { describe, expect, it } from "vitest";
import type { Identity, NamespacePermission } from "@/api/rabbitmq";
import {
  canManage,
  grantsEverything,
  grantsNothing,
  hasNoAccess,
  isAdministrator,
  patternKind,
} from "./permissions";

const permission = (over: Partial<NamespacePermission> = {}): NamespacePermission =>
  ({ namespace: "/", identity: "app", configure: "", write: "", read: "", ...over }) as NamespacePermission;

const identity = (over: Partial<Identity> = {}): Identity =>
  ({ name: "app", tags: [], hasPassword: true, permissions: [], ...over }) as Identity;

describe("permission patterns", () => {
  /*
   * Three states, not two. An empty pattern matches nothing and permits
   * nothing; ".*" permits everything; anything else is a real expression a
   * reader has to look at. Rendering empty as "not set" would describe the
   * opposite of what it does.
   */
  it("tells empty from everything from an actual pattern", () => {
    expect(patternKind("")).toBe("none");
    expect(patternKind(".*")).toBe("all");
    expect(patternKind("^order\\.")).toBe("pattern");
  });

  it("reads a permission that grants nothing", () => {
    expect(grantsNothing(permission())).toBe(true);
    expect(grantsNothing(permission({ read: ".*" }))).toBe(false);
  });

  it("reads a permission that grants everything", () => {
    expect(grantsEverything(permission({ configure: ".*", write: ".*", read: ".*" }))).toBe(true);
    // Two out of three is not everything, and must not read as it.
    expect(grantsEverything(permission({ configure: ".*", write: ".*" }))).toBe(false);
  });
});

describe("the two ways a user is configured into uselessness", () => {
  /*
   * No permission anywhere means the broker refuses every connection, which
   * the application sees as something that looks like a wrong password. It is
   * worth naming rather than leaving someone to infer it from an empty list.
   */
  it("spots a user the broker will refuse everywhere", () => {
    expect(hasNoAccess(identity())).toBe(true);
    expect(hasNoAccess(identity({ permissions: [permission()] }))).toBe(true);
    expect(hasNoAccess(identity({ permissions: [permission({ read: ".*" })] }))).toBe(false);
  });

  /*
   * The opposite failure: a credential that works perfectly over AMQP while
   * every page in this app fails, because the user has no management tag.
   */
  it("spots a user that cannot reach the management API", () => {
    expect(canManage(identity())).toBe(false);
    expect(canManage(identity({ tags: ["management"] }))).toBe(true);
    // A tag the operator invented is stored by the broker and ignored.
    expect(canManage(identity({ tags: ["our-own-label"] }))).toBe(false);
  });

  it("spots an administrator, whose permissions are beside the point", () => {
    expect(isAdministrator(identity({ tags: ["administrator"] }))).toBe(true);
    expect(isAdministrator(identity({ tags: ["monitoring"] }))).toBe(false);
  });
});
