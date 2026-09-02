import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Segmented } from "@/components";
import { formatErrorMessage } from "@/lib/utils";
import type { AclUser } from "@/api/models";
import type { AclUserDraft } from "@/api/redis";

/** How the user authenticates. The three are genuinely different outcomes. */
export type AuthChoice = "keep" | "set" | "any" | "none";

export interface AclUserForm {
  name: string;
  enabled: boolean;
  auth: AuthChoice;
  password: string;
  /** Whitespace separated, in the server's own language. */
  keyPatterns: string;
  channelPatterns: string;
  commandRules: string;
}

export function emptyAclUserForm(): AclUserForm {
  return {
    name: "",
    enabled: true,
    // A new user has nothing to keep, so it starts at "set a password" - the
    // only choice that produces an account which can actually be used.
    auth: "set",
    password: "",
    keyPatterns: "",
    channelPatterns: "",
    // Denying everything first is the only safe starting point: a rule list
    // is applied left to right, so a grant with no -@all before it adds to
    // whatever the default already allows.
    commandRules: "-@all",
  };
}

/** Reads an existing user back into the form. */
export function toForm(user: AclUser): AclUserForm {
  return {
    name: user.name,
    enabled: user.enabled,
    // Keep, because an edit is usually not about the password and the stored
    // hashes are put back by the driver.
    auth: user.noPassword ? "any" : "keep",
    password: "",
    keyPatterns: (user.keyPatterns ?? []).join(" "),
    channelPatterns: (user.channelPatterns ?? []).join(" "),
    commandRules: user.commandRules,
  };
}

export function validate(
  form: AclUserForm,
  t: (key: string) => string,
  existing: boolean,
): string | null {
  const name = form.name.trim();
  if (name === "") return t("board.acl.redis.form.nameRequired");
  // The rule language is whitespace separated, so a name with a space would be
  // read as two arguments and change what the rule says.
  if (/\s/.test(name)) return t("board.acl.redis.form.nameSpaces");
  if (form.auth === "set" && form.password === "") {
    return t("board.acl.redis.form.passwordRequired");
  }
  if (form.auth === "keep" && !existing) {
    return t("board.acl.redis.form.passwordRequired");
  }
  return null;
}

function words(value: string): string[] {
  return value.split(/\s+/).filter((word) => word !== "");
}

export function toDraft(form: AclUserForm): AclUserDraft {
  return {
    name: form.name.trim(),
    enabled: form.enabled,
    password: form.auth === "set" ? form.password : "",
    clearPasswords: form.auth === "none",
    noPassword: form.auth === "any",
    keyPatterns: words(form.keyPatterns),
    channelPatterns: words(form.channelPatterns),
    commandRules: words(form.commandRules),
  };
}

/**
 * Creating or editing an ACL user.
 *
 * The rules are typed in Redis's own language rather than assembled from
 * checkboxes. It has more forms than a form can model - %R~ and %W~ split
 * reads from writes, selectors nest in parentheses, order matters because the
 * server applies rules left to right - and a builder that covered half of it
 * would quietly refuse to express the other half.
 *
 * Saving replaces the user rather than adding to it, which is what makes the
 * form the whole truth. The password is the exception: it survives an edit
 * that did not mention it, because the driver puts the stored hashes back.
 */
export function AclUserDialog({
  open,
  user,
  categories,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  /** Null when creating. */
  user: AclUser | null;
  categories: string[];
  onOpenChange: (open: boolean) => void;
  onSave: (draft: AclUserDraft) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<AclUserForm>(emptyAclUserForm());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(user == null ? emptyAclUserForm() : toForm(user));
      setError(null);
    }
  }, [open, user]);

  const set = <K extends keyof AclUserForm>(key: K, next: AclUserForm[K]) =>
    setForm((current) => ({ ...current, [key]: next }));

  const invalid = validate(form, t, user != null);

  const submit = async () => {
    if (invalid != null || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(toDraft(form));
    } catch (saveError) {
      setError(formatErrorMessage(saveError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>
            {user == null
              ? t("board.acl.redis.newUser")
              : t("board.acl.redis.form.editTitle", { name: user.name })}
          </DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="redis-acl-name">user</FieldLabel>
            <Input
              id="redis-acl-name"
              className="mono3"
              value={form.name}
              disabled={user != null}
              placeholder="reporting-service"
              onChange={(event) => set("name", event.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel>{t("board.acl.redis.form.state")}</FieldLabel>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Switch checked={form.enabled} onCheckedChange={(next) => set("enabled", next)} />
              <span style={{ fontSize: "11.5px", color: "var(--c-muted)" }}>
                {t("board.acl.redis.form.stateHint")}
              </span>
            </div>
          </Field>

          <Field>
            <FieldLabel>{t("board.acl.redis.auth")}</FieldLabel>
            <Segmented
              style={{ alignSelf: "flex-start" }}
              value={form.auth}
              onChange={(next: AuthChoice) => set("auth", next)}
              options={[
                ...(user != null
                  ? [{ value: "keep" as const, label: t("board.acl.redis.form.keep") }]
                  : []),
                { value: "set", label: t("board.acl.redis.form.setPassword") },
                { value: "any", label: t("board.acl.redis.mode.any") },
                { value: "none", label: t("board.acl.redis.mode.none") },
              ]}
            />
            <FieldDescription>{t(`board.acl.redis.form.${form.auth}Hint`)}</FieldDescription>
          </Field>

          {form.auth === "set" && (
            <Field>
              <FieldLabel htmlFor="redis-acl-password">
                {t("page.connections.form.password")}
              </FieldLabel>
              <Input
                id="redis-acl-password"
                type="password"
                value={form.password}
                onChange={(event) => set("password", event.target.value)}
              />
            </Field>
          )}

          <Field>
            <FieldLabel htmlFor="redis-acl-keys">{t("board.acl.redis.keys")}</FieldLabel>
            <Input
              id="redis-acl-keys"
              className="mono3"
              value={form.keyPatterns}
              placeholder="~orders:* ~events:*"
              onChange={(event) => set("keyPatterns", event.target.value)}
            />
            <FieldDescription>{t("board.acl.redis.form.keysHint")}</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="redis-acl-channels">{t("board.acl.redis.channels")}</FieldLabel>
            <Input
              id="redis-acl-channels"
              className="mono3"
              value={form.channelPatterns}
              placeholder="&*"
              onChange={(event) => set("channelPatterns", event.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="redis-acl-commands">{t("board.acl.redis.commands")}</FieldLabel>
            <Input
              id="redis-acl-commands"
              className="mono3"
              value={form.commandRules}
              placeholder="-@all +@read +@connection"
              onChange={(event) => set("commandRules", event.target.value)}
            />
            <FieldDescription>
              {t("board.acl.redis.form.commandsHint")}
              {categories.length > 0 && (
                <>
                  {" "}
                  {t("board.acl.redis.form.categories", {
                    categories: categories.slice(0, 8).join(", "),
                  })}
                </>
              )}
            </FieldDescription>
          </Field>

          <FieldDescription>{t("board.acl.redis.form.replaces")}</FieldDescription>

          {error != null && (
            <FieldDescription style={{ color: "var(--c-err)" }}>{error}</FieldDescription>
          )}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("board.common.cancel")}
          </Button>
          <Button
            disabled={invalid != null || busy}
            title={invalid ?? undefined}
            onClick={() => void submit()}
          >
            {busy && <Spinner className="size-3.5" />}
            {t("board.common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
