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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Segmented } from "@/components";
import type { AccessPrincipal } from "@/api/acl";
import { formatErrorMessage } from "@/lib/utils";

/** RocketMQ's own words, which is why they are not translated. */
const TYPES = ["Normal", "Super"] as const;
const STATUSES = ["enable", "disable"] as const;

export interface PrincipalForm {
  name: string;
  secret: string;
  type: string;
  status: string;
}

/**
 * Create or edit one identity the broker authenticates.
 *
 * Editing leaves the secret blank, and a blank secret is sent as one: the
 * broker stores it hashed and never hands it back, so a form that pre-filled
 * anything there would be showing a value it invented.
 */
export function PrincipalDialog({
  open,
  editing,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** The principal being edited, or undefined to create one. */
  editing: AccessPrincipal | undefined;
  onClose: () => void;
  onSubmit: (form: PrincipalForm) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<PrincipalForm>({
    name: "",
    secret: "",
    type: TYPES[0],
    status: STATUSES[0],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm({
      name: editing?.name ?? "",
      secret: "",
      type: editing?.type || TYPES[0],
      status: editing?.status || STATUSES[0],
    });
    setError(null);
    setSaving(false);
  }, [editing, open]);

  const invalid =
    form.name.trim() === ""
      ? t("board.acl.principal.nameRequired")
      : editing == null && form.secret === ""
        ? t("board.acl.principal.secretRequired")
        : null;

  const save = async () => {
    if (invalid != null) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ ...form, name: form.name.trim() });
      onClose();
    } catch (failure) {
      setError(formatErrorMessage(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            {t(editing == null ? "board.acl.principal.create" : "board.acl.principal.edit")}
          </DialogTitle>
        </DialogHeader>

        <FieldGroup className="gap-3">
          <Field>
            <FieldLabel htmlFor="principal-name">{t("board.acl.principal.name")}</FieldLabel>
            <Input
              id="principal-name"
              className="mono3"
              value={form.name}
              disabled={editing != null}
              onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="principal-secret">{t("board.acl.principal.secret")}</FieldLabel>
            <Input
              id="principal-secret"
              type="password"
              value={form.secret}
              placeholder={editing != null ? t("board.acl.principal.secretKeep") : undefined}
              onChange={(event) => setForm((f) => ({ ...f, secret: event.target.value }))}
            />
          </Field>

          <Field>
            <FieldLabel>{t("board.acl.principal.type")}</FieldLabel>
            <Segmented
              className="self-start"
              value={form.type}
              onChange={(next: string) => setForm((f) => ({ ...f, type: next }))}
              options={TYPES.map((value) => ({ value, label: value }))}
            />
          </Field>

          <Field>
            <FieldLabel>{t("board.acl.principal.status")}</FieldLabel>
            <Segmented
              className="self-start"
              value={form.status}
              onChange={(next: string) => setForm((f) => ({ ...f, status: next }))}
              options={STATUSES.map((value) => ({
                value,
                label: t(`board.acl.principal.statusValue.${value}`),
              }))}
            />
          </Field>
        </FieldGroup>

        <DialogFooter className="items-center">
          {(invalid ?? error) != null && (
            <span
              className={
                "mr-auto max-w-72 text-xs " +
                (error != null ? "text-(--c-err)" : "text-muted-foreground")
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
