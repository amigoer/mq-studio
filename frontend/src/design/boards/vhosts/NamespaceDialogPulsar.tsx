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
import { validateName } from "@/mq/pulsar/namespaces";
import { formatErrorMessage } from "@/lib/utils";

/**
 * Create a Pulsar namespace.
 *
 * Only a name, because that is all Pulsar's create takes. Its policies - the
 * TTL, the retention pair, the per-topic caps - are separate calls made after
 * it exists, so a form that collected them here would either apply them in a
 * second round the user cannot see fail, or imply the create carried them.
 * They are edited from the row once the namespace is there.
 */
export function NamespaceDialogPulsar({
  open,
  tenant,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** The tenant the namespace will be created under, shown but not editable. */
  tenant: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setError(null);
    setSaving(false);
  }, [open]);

  const invalid = validateName(name, t);

  const save = async () => {
    if (invalid != null) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(name.trim());
      onClose();
    } catch (failure) {
      setError(formatErrorMessage(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t("board.vhosts.pulsar.newTitle")}</DialogTitle>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="namespace-tenant">
              {t("board.vhosts.pulsar.tenant")}
            </FieldLabel>
            {/* The tenant comes from the connection, not from this form: a
                namespace created under a different one would be invisible to
                every other page, which all read this connection's scope. */}
            <Input id="namespace-tenant" className="mono3" value={tenant} disabled />
          </Field>
          <Field>
            <FieldLabel htmlFor="namespace-name">{t("board.vhosts.pulsar.name")}</FieldLabel>
            <Input
              id="namespace-name"
              className="mono3"
              value={name}
              placeholder="orders"
              onChange={(event) => setName(event.target.value)}
            />
            <FieldDescription>{t("board.vhosts.pulsar.nameHint")}</FieldDescription>
          </Field>
        </FieldGroup>

        <DialogFooter className="items-center">
          {(invalid ?? error) != null && (
            <span
              className={
                "max-w-80 text-right text-xs " +
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
