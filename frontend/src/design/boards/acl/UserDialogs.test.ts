import { describe, expect, it } from "vitest";
import type { Identity, NamespacePermission } from "@/api/rabbitmq";
import {
  applyPreset,
  emptyIdentityForm,
  emptyPermissionForm,
  identityFormOf,
  permissionFormOf,
  toIdentityInput,
  toPermissionInput,
  validateIdentity,
  validatePermission,
} from "./UserDialogs";

const t = (key: string) => key;

describe("the user form", () => {
  it("trims the name and keeps the tags chosen", () => {
    const input = toIdentityInput({
      ...emptyIdentityForm(),
      name: "  order-service  ",
      tags: ["management", "policymaker"],
      password: "s3cret",
    });
    expect(input.name).toBe("order-service");
    expect(input.tags).toEqual(["management", "policymaker"]);
  });

  /*
   * A new user with no password is a real configuration - certificate or
   * OAuth authentication - but it has to be asked for rather than fallen into
   * by leaving a field blank.
   */
  it("refuses a blank password on a new user unless it was chosen", () => {
    expect(validateIdentity({ ...emptyIdentityForm(), name: "app" }, true, t)).toBe(
      "board.acl.rabbitmq.passwordRequired",
    );
    expect(
      validateIdentity(
        { ...emptyIdentityForm(), name: "app", withoutPassword: true },
        true,
        t,
      ),
    ).toBeNull();
  });

  /*
   * On an edit, blank means "keep the stored one", which is what makes
   * changing tags possible without knowing the password. The two instructions
   * have to reach the driver as different things, because the broker's own
   * update endpoint replaces the whole user and cannot express "keep it".
   */
  it("distinguishes a blank password from asking for none", () => {
    const keep = toIdentityInput({ ...emptyIdentityForm(), name: "app" });
    expect(keep.password).toBe("");
    expect(keep.withoutPassword).toBe(false);

    const none = toIdentityInput({ ...emptyIdentityForm(), name: "app", withoutPassword: true });
    expect(none.password).toBe("");
    expect(none.withoutPassword).toBe(true);

    expect(validateIdentity({ ...emptyIdentityForm(), name: "app" }, false, t)).toBeNull();
  });

  it("reads an existing user back without its password", () => {
    const form = identityFormOf({
      name: "app",
      tags: ["management"],
      hasPassword: true,
      permissions: [],
    } as unknown as Identity);
    expect(form.name).toBe("app");
    expect(form.tags).toEqual(["management"]);
    expect(form.password).toBe("");
  });
});

describe("permission presets", () => {
  /*
   * The presets are what people mean nine times in ten, and getting them
   * wrong grants or denies more than was asked for.
   */
  it("grants everything for full", () => {
    const applied = applyPreset({ ...emptyPermissionForm("/"), preset: "full" });
    expect([applied.configure, applied.write, applied.read]).toEqual([".*", ".*", ".*"]);
  });

  it("grants only read for consume-only", () => {
    const applied = applyPreset({ ...emptyPermissionForm("/"), preset: "readonly" });
    expect([applied.configure, applied.write, applied.read]).toEqual(["", "", ".*"]);
  });

  it("grants only write for publish-only", () => {
    const applied = applyPreset({ ...emptyPermissionForm("/"), preset: "publish" });
    expect([applied.configure, applied.write, applied.read]).toEqual(["", ".*", ""]);
  });

  // Custom leaves whatever was typed alone, which is the whole point of it.
  it("leaves a custom pattern untouched", () => {
    const applied = applyPreset({
      ...emptyPermissionForm("/"),
      preset: "custom",
      configure: "^order\\.",
      write: "^order\\.",
      read: "",
    });
    expect(applied.configure).toBe("^order\\.");
    expect(applied.read).toBe("");
  });

  it("carries the identity and the virtual host into the request", () => {
    const input = toPermissionInput(
      { ...emptyPermissionForm(" /orders "), preset: "readonly" },
      "app",
    );
    expect(input.vhost).toBe("/orders");
    expect(input.identity).toBe("app");
    expect(input.read).toBe(".*");
  });

  /*
   * Editing an existing permission opens on custom, because the stored
   * patterns are whatever someone set and a preset would silently rewrite
   * them the moment the dialog opened.
   */
  it("opens an existing permission as custom", () => {
    const form = permissionFormOf({
      namespace: "/orders",
      identity: "app",
      configure: "^order\\.",
      write: ".*",
      read: "",
    } as NamespacePermission);
    expect(form.preset).toBe("custom");
    expect(form.configure).toBe("^order\\.");
  });

  it("needs a virtual host", () => {
    expect(validatePermission(emptyPermissionForm(), t)).toBe(
      "board.acl.rabbitmq.vhostRequired",
    );
    expect(validatePermission(emptyPermissionForm("/"), t)).toBeNull();
  });
});
