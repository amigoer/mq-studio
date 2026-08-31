import { useEffect, useMemo, useState } from "react";
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
import { Combobox, Segmented } from "@/components";
import { KNOWN_TAGS, PATTERN_ALL, PATTERN_NONE } from "@/mq/rabbitmq/permissions";
import { formatErrorMessage } from "@/lib/utils";
import type {
  Identity,
  IdentityInput,
  NamespacePermission,
  PermissionInput,
} from "@/api/rabbitmq";

export interface IdentityForm {
  name: string;
  tags: string[];
  password: string;
  /**
   * Set deliberately, and only on a new user. It creates one that cannot
   * authenticate with a password - correct for certificate or OAuth
   * authentication, and a mistake if it happened by leaving a field blank.
   *
   * It is not the same as an empty password, which keeps whatever is stored.
   */
  withoutPassword: boolean;
}

export function emptyIdentityForm(): IdentityForm {
  return { name: "", tags: ["management"], password: "", withoutPassword: false };
}

export function identityFormOf(identity: Identity): IdentityForm {
  return {
    name: identity.name,
    tags: identity.tags ?? [],
    // The stored password never comes back, and an empty field on an edit
    // means "leave it alone".
    password: "",
    withoutPassword: false,
  };
}

export function toIdentityInput(form: IdentityForm): IdentityInput {
  return {
    name: form.name.trim(),
    tags: form.tags,
    password: form.withoutPassword ? "" : form.password,
    withoutPassword: form.withoutPassword,
  };
}

export function validateIdentity(
  form: IdentityForm,
  isNew: boolean,
  t: (key: string) => string,
): string | null {
  if (form.name.trim() === "") return t("board.acl.rabbitmq.nameRequired");
  // On a new user a blank password is a real configuration, but it has to be
  // asked for rather than fallen into.
  if (isNew && form.password === "" && !form.withoutPassword) {
    return t("board.acl.rabbitmq.passwordRequired");
  }
  return null;
}

/** Creating or editing a user. */
export function IdentityDialog({
  open,
  editing,
  onClose,
  onSubmit,
}: {
  open: boolean;
  editing?: Identity;
  onClose: () => void;
  onSubmit: (input: IdentityInput) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<IdentityForm>(emptyIdentityForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(editing != null ? identityFormOf(editing) : emptyIdentityForm());
    setError(null);
    setSaving(false);
  }, [editing, open]);

  const isNew = editing == null;
  const invalid = useMemo(() => validateIdentity(form, isNew, t), [form, isNew, t]);

  const toggleTag = (tag: string) =>
    setForm((current) => ({
      ...current,
      tags: current.tags.includes(tag)
        ? current.tags.filter((existing) => existing !== tag)
        : [...current.tags, tag],
    }));

  const save = async () => {
    if (invalid != null) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(toIdentityInput(form));
      onClose();
    } catch (saveError) {
      setError(formatErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3.5 overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>
            {t(isNew ? "board.acl.rabbitmq.new" : "board.acl.rabbitmq.edit")}
          </DialogTitle>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="user-name">{t("board.common.user")}</FieldLabel>
            <Input
              id="user-name"
              value={form.name}
              placeholder="order-service"
              disabled={!isNew}
              onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))}
            />
            {!isNew && (
              <FieldDescription>{t("board.acl.rabbitmq.nameFixed")}</FieldDescription>
            )}
          </Field>

          <Field>
            <FieldLabel>{t("board.acl.rabbitmq.tags")}</FieldLabel>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {KNOWN_TAGS.map((tag) => (
                <Button
                  key={tag}
                  type="button"
                  size="xs"
                  variant={form.tags.includes(tag) ? "default" : "outline"}
                  onClick={() => toggleTag(tag)}
                >
                  {tag}
                </Button>
              ))}
            </div>
            <FieldDescription>{t("board.acl.rabbitmq.tagsHint")}</FieldDescription>
          </Field>

          {isNew && (
            <Field orientation="horizontal">
              <FieldLabel htmlFor="user-nopassword">
                {t("board.acl.rabbitmq.withoutPassword")}
              </FieldLabel>
              <Switch
                id="user-nopassword"
                checked={form.withoutPassword}
                onCheckedChange={(next: boolean) =>
                  setForm((c) => ({ ...c, withoutPassword: next, password: "" }))
                }
              />
            </Field>
          )}
          {isNew && form.withoutPassword && (
            <FieldDescription>{t("board.acl.rabbitmq.withoutPasswordHint")}</FieldDescription>
          )}

          {!form.withoutPassword && (
            <Field>
              <FieldLabel htmlFor="user-password">
                {t("board.acl.rabbitmq.password")}
              </FieldLabel>
              <Input
                id="user-password"
                type="password"
                value={form.password}
                placeholder={isNew ? undefined : t("board.acl.rabbitmq.passwordUnchanged")}
                onChange={(event) => setForm((c) => ({ ...c, password: event.target.value }))}
              />
              {!isNew && (
                <FieldDescription>{t("board.acl.rabbitmq.passwordEditHint")}</FieldDescription>
              )}
            </Field>
          )}
        </FieldGroup>

        <DialogFooter className="items-center">
          {(invalid ?? error) != null && (
            <span
              className={
                "flex-1 text-xs " + (error != null ? "text-(--c-err)" : "text-muted-foreground")
              }
            >
              {error ?? invalid}
            </span>
          )}
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={invalid != null || saving} onClick={() => void save()}>
            {saving && <Spinner />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The presets, which are what people actually mean nine times in ten. */
type Preset = "full" | "readonly" | "publish" | "custom";

export interface PermissionForm {
  vhost: string;
  preset: Preset;
  configure: string;
  write: string;
  read: string;
}

export function emptyPermissionForm(vhost = ""): PermissionForm {
  return { vhost, preset: "full", configure: PATTERN_ALL, write: PATTERN_ALL, read: PATTERN_ALL };
}

export function permissionFormOf(permission: NamespacePermission): PermissionForm {
  return {
    vhost: permission.namespace,
    preset: "custom",
    configure: permission.configure,
    write: permission.write,
    read: permission.read,
  };
}

/**
 * The three patterns a preset stands for.
 *
 * Read-only still needs write on nothing rather than write unset, because the
 * two are the same to the broker and different to a reader - and a consumer
 * genuinely does need read only: binding a queue needs write on the queue,
 * which is why "publish only" is not the mirror image of it.
 */
export function applyPreset(form: PermissionForm): PermissionForm {
  switch (form.preset) {
    case "full":
      return { ...form, configure: PATTERN_ALL, write: PATTERN_ALL, read: PATTERN_ALL };
    case "readonly":
      return { ...form, configure: PATTERN_NONE, write: PATTERN_NONE, read: PATTERN_ALL };
    case "publish":
      return { ...form, configure: PATTERN_NONE, write: PATTERN_ALL, read: PATTERN_NONE };
    default:
      return form;
  }
}

export function toPermissionInput(form: PermissionForm, identity: string): PermissionInput {
  const applied = applyPreset(form);
  return {
    vhost: applied.vhost.trim(),
    identity,
    configure: applied.configure,
    write: applied.write,
    read: applied.read,
  };
}

export function validatePermission(
  form: PermissionForm,
  t: (key: string) => string,
): string | null {
  if (form.vhost.trim() === "") return t("board.acl.rabbitmq.vhostRequired");
  return null;
}

/** Granting or editing one identity's permissions in one virtual host. */
export function PermissionDialog({
  open,
  identity,
  editing,
  vhosts,
  onClose,
  onSubmit,
}: {
  open: boolean;
  identity: string;
  editing?: NamespacePermission;
  vhosts: readonly string[];
  onClose: () => void;
  onSubmit: (input: PermissionInput) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<PermissionForm>(emptyPermissionForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(editing != null ? permissionFormOf(editing) : emptyPermissionForm());
    setError(null);
    setSaving(false);
  }, [editing, open]);

  const invalid = useMemo(() => validatePermission(form, t), [form, t]);
  const applied = applyPreset(form);

  const save = async () => {
    if (invalid != null) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(toPermissionInput(form, identity));
      onClose();
    } catch (saveError) {
      setError(formatErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3.5 overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t("board.acl.rabbitmq.grantTitle", { identity })}</DialogTitle>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel>{t("board.vhosts.rabbitmq.title")}</FieldLabel>
            <Combobox
              value={form.vhost}
              onValueChange={(next) => setForm((c) => ({ ...c, vhost: next }))}
              options={vhosts}
              placeholder={t("board.acl.rabbitmq.pickVhost")}
              disabled={editing != null}
            />
          </Field>

          <Field>
            <FieldLabel>{t("board.acl.rabbitmq.preset")}</FieldLabel>
            <Segmented
              block
              value={form.preset}
              onChange={(next: Preset) => setForm((c) => applyPreset({ ...c, preset: next }))}
              options={[
                { value: "full", label: t("board.acl.rabbitmq.presetFull") },
                { value: "publish", label: t("board.acl.rabbitmq.presetPublish") },
                { value: "readonly", label: t("board.acl.rabbitmq.presetReadonly") },
                { value: "custom", label: t("board.acl.rabbitmq.presetCustom") },
              ]}
            />
            <FieldDescription>{t("board.acl.rabbitmq.patternHint")}</FieldDescription>
          </Field>

          {(["configure", "write", "read"] as const).map((field) => (
            <Field key={field}>
              <FieldLabel htmlFor={`perm-${field}`}>
                {t(`board.acl.rabbitmq.${field}`)}
              </FieldLabel>
              <Input
                id={`perm-${field}`}
                className="mono3"
                value={applied[field]}
                placeholder={t("board.acl.rabbitmq.patternNone")}
                disabled={form.preset !== "custom"}
                onChange={(event) =>
                  setForm((c) => ({ ...c, [field]: event.target.value }))
                }
              />
              <FieldDescription>{t(`board.acl.rabbitmq.${field}Hint`)}</FieldDescription>
            </Field>
          ))}
        </FieldGroup>

        <DialogFooter className="items-center">
          {(invalid ?? error) != null && (
            <span
              className={
                "flex-1 text-xs " + (error != null ? "text-(--c-err)" : "text-muted-foreground")
              }
            >
              {error ?? invalid}
            </span>
          )}
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={invalid != null || saving} onClick={() => void save()}>
            {saving && <Spinner />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
