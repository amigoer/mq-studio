import { describe, expect, it } from "vitest";
import type { AclUser } from "@bindings/model/models";
import {
  allowsAnonymousAccess,
  authMode,
  grantsEveryCommand,
  isDefaultUser,
  reachesEveryKey,
} from "./acl";

function user(over: Partial<AclUser> = {}): AclUser {
  return {
    name: "app",
    enabled: true,
    noPassword: false,
    passwordCount: 1,
    keyPatterns: ["~app:*"],
    channelPatterns: ["&*"],
    commandRules: "-@all +@read",
    selectors: [],
    rule: "user app on #aaa ~app:* &* -@all +@read",
    ...over,
  } as unknown as AclUser;
}

describe("the Redis ACL readers", () => {
  /*
   * The three authentication modes are genuinely different and the middle one
   * is dangerous: "any" accepts every password including none, "none" means
   * the user exists and cannot log in at all, and confusing them is how a
   * server is left open.
   */
  it("separates a password from any password from none", () => {
    expect(authMode(user())).toBe("password");
    expect(authMode(user({ noPassword: true, passwordCount: 0 }))).toBe("any");
    expect(authMode(user({ passwordCount: 0 }))).toBe("none");
    // nopass wins even where a hash is somehow also set: the server accepts
    // anything, and reporting "password" would understate the exposure.
    expect(authMode(user({ noPassword: true, passwordCount: 2 }))).toBe("any");
  });

  /*
   * The difference between an account scoped to its own data and one that can
   * read and overwrite everything on the server.
   */
  it("notices a user that can reach every key", () => {
    expect(reachesEveryKey(user())).toBe(false);
    expect(reachesEveryKey(user({ keyPatterns: ["~*"] }))).toBe(true);
    expect(reachesEveryKey(user({ keyPatterns: ["allkeys"] }))).toBe(true);
    // A pattern that merely looks broad is not the same thing.
    expect(reachesEveryKey(user({ keyPatterns: ["~app:*", "~cache:*"] }))).toBe(false);
  });

  /*
   * Read off the end of the rule text rather than computed: the language
   * allows +@all followed by exclusions, and what a rule adds up to is the
   * server's job. What this answers is whether the grant ends at everything.
   */
  it("notices a user granted every command", () => {
    expect(grantsEveryCommand(user({ commandRules: "+@all" }))).toBe(true);
    expect(grantsEveryCommand(user({ commandRules: "-@all +@read" }))).toBe(false);
    // +@all then narrowed is not "every command", and saying it was would
    // overstate what the account can do.
    expect(grantsEveryCommand(user({ commandRules: "+@all -@dangerous" }))).toBe(false);
    expect(grantsEveryCommand(user({ commandRules: "" }))).toBe(false);
  });

  it("recognises the default user, which cannot be removed", () => {
    expect(isDefaultUser(user({ name: "default" }))).toBe(true);
    expect(isDefaultUser(user())).toBe(false);
  });

  /*
   * The single most consequential fact on the page: a default user that is on
   * and accepts any password is a Redis reachable without credentials.
   */
  describe("anonymous access", () => {
    it("is open when the default user is on and takes any password", () => {
      const open = user({ name: "default", enabled: true, noPassword: true, passwordCount: 0 });
      expect(allowsAnonymousAccess([open, user()])).toBe(true);
    });

    it("is closed when the default user is off", () => {
      const off = user({ name: "default", enabled: false, noPassword: false, passwordCount: 0 });
      expect(allowsAnonymousAccess([off, user()])).toBe(false);
    });

    it("is closed when the default user needs a password", () => {
      const guarded = user({ name: "default", enabled: true, noPassword: false });
      expect(allowsAnonymousAccess([guarded])).toBe(false);
    });

    // Another user being open changes nothing: only the default one is reached
    // without naming a user.
    it("ignores a non-default user that takes any password", () => {
      const open = user({ name: "app", enabled: true, noPassword: true });
      const guarded = user({ name: "default", enabled: false });
      expect(allowsAnonymousAccess([open, guarded])).toBe(false);
    });

    it("is closed when there is no default user at all", () => {
      expect(allowsAnonymousAccess([user()])).toBe(false);
      expect(allowsAnonymousAccess([])).toBe(false);
    });
  });
});
