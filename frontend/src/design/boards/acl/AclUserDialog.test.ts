import { describe, expect, it } from "vitest";
import type { AclUser } from "@/api/models";
import { emptyAclUserForm, toDraft, toForm, validate } from "./AclUserDialog";

const t = (key: string) => key;

const user = (over: Partial<AclUser> = {}) =>
  ({
    name: "app",
    enabled: true,
    noPassword: false,
    passwordCount: 1,
    keyPatterns: ["~app:*", "~cache:*"],
    channelPatterns: ["&*"],
    commandRules: "-@all +@read",
    selectors: [],
    rule: "user app on #aaa ~app:* ~cache:* &* -@all +@read",
    ...over,
  }) as unknown as AclUser;

describe("the ACL user a form saves", () => {
  /*
   * A rule list is applied left to right, so a grant with no -@all before it
   * adds to whatever the server's default already allows. Starting there is
   * the only safe default for a new account.
   */
  it("starts a new user by denying everything", () => {
    const form = emptyAclUserForm();
    expect(form.commandRules).toBe("-@all");
    expect(form.enabled).toBe(true);
    // A new user has nothing to keep, so "keep the password" is not offered.
    expect(form.auth).toBe("set");
  });

  it("reads an existing user back, defaulting to keeping its password", () => {
    const form = toForm(user());
    expect(form.name).toBe("app");
    expect(form.keyPatterns).toBe("~app:* ~cache:*");
    expect(form.commandRules).toBe("-@all +@read");
    // An edit is usually not about the password, and the driver puts the
    // stored hashes back after the reset.
    expect(form.auth).toBe("keep");
  });

  it("reads a nopass user as accepting any password", () => {
    expect(toForm(user({ noPassword: true, passwordCount: 0 })).auth).toBe("any");
  });

  it("needs a name, and refuses one with a space in it", () => {
    expect(validate(emptyAclUserForm(), t, false)).toBe("board.acl.redis.form.nameRequired");
    // The rule language is whitespace separated, so a name with a space would
    // be read as two arguments and change what the rule says.
    const spaced = { ...emptyAclUserForm(), name: "two words", password: "x" };
    expect(validate(spaced, t, false)).toBe("board.acl.redis.form.nameSpaces");
  });

  it("needs a password unless the user authenticates another way", () => {
    const form = { ...emptyAclUserForm(), name: "app" };
    expect(validate(form, t, false)).toBe("board.acl.redis.form.passwordRequired");
    expect(validate({ ...form, password: "hunter2" }, t, false)).toBeNull();
    // "any" and "none" are both complete answers about authentication.
    expect(validate({ ...form, auth: "any" }, t, false)).toBeNull();
    expect(validate({ ...form, auth: "none" }, t, false)).toBeNull();
    // "keep" is not, on a user that does not exist yet.
    expect(validate({ ...form, auth: "keep" }, t, false)).toBe(
      "board.acl.redis.form.passwordRequired",
    );
    expect(validate({ ...form, auth: "keep" }, t, true)).toBeNull();
  });

  /*
   * The three password outcomes have to reach the driver as three different
   * things: keeping, replacing, and removing every password so the user cannot
   * log in at all - which is the opposite of accepting any password.
   */
  it("sends the three password outcomes distinctly", () => {
    const form = { ...emptyAclUserForm(), name: "app" };

    const keep = toDraft({ ...form, auth: "keep" });
    expect(keep.password).toBe("");
    expect(keep.clearPasswords).toBe(false);
    expect(keep.noPassword).toBe(false);

    const set = toDraft({ ...form, auth: "set", password: "hunter2" });
    expect(set.password).toBe("hunter2");
    expect(set.clearPasswords).toBe(false);

    const any = toDraft({ ...form, auth: "any", password: "typed then abandoned" });
    expect(any.noPassword).toBe(true);
    // A password typed and then abandoned must not travel with it.
    expect(any.password).toBe("");

    const none = toDraft({ ...form, auth: "none" });
    expect(none.clearPasswords).toBe(true);
    expect(none.noPassword).toBe(false);
  });

  it("splits the pattern and rule fields on whitespace", () => {
    const draft = toDraft({
      ...emptyAclUserForm(),
      name: "  app  ",
      keyPatterns: "  ~app:*   ~cache:*  ",
      channelPatterns: "&events:*",
      commandRules: "-@all  +@read   +@connection",
    });
    expect(draft.name).toBe("app");
    expect(draft.keyPatterns).toEqual(["~app:*", "~cache:*"]);
    expect(draft.channelPatterns).toEqual(["&events:*"]);
    expect(draft.commandRules).toEqual(["-@all", "+@read", "+@connection"]);
  });

  it("sends empty lists for fields left blank", () => {
    const draft = toDraft({ ...emptyAclUserForm(), name: "app", commandRules: "" });
    expect(draft.keyPatterns).toEqual([]);
    expect(draft.channelPatterns).toEqual([]);
    expect(draft.commandRules).toEqual([]);
  });
});
