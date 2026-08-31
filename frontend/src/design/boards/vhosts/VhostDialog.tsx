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
import { Segmented } from "@/components";
import { formatErrorMessage } from "@/lib/utils";
import type { Namespace, NamespaceInput } from "@/api/rabbitmq";

/**
 * What a queue declared without a type becomes.
 *
 * The empty option is the broker's own default, which is classic. Setting this
 * to quorum is how a cluster stops accumulating classic queues by accident -
 * most client libraries declare without a type, so whatever is chosen here is
 * what most queues will be.
 */
const DEFAULT_TYPES = [
  { value: "", label: "board.vhosts.rabbitmq.brokerDefault" },
  { value: "quorum", label: "quorum" },
  { value: "classic", label: "classic" },
  { value: "stream", label: "stream" },
] as const;

export interface VhostForm {
  name: string;
  description: string;
  tags: string;
  defaultQueueType: string;
  tracing: boolean;
}

export function emptyVhostForm(): VhostForm {
  return {
    name: "",
    description: "",
    tags: "",
    // Quorum by default on a new vhost, for the reason above. An existing one
    // keeps whatever it already has.
    defaultQueueType: "quorum",
    tracing: false,
  };
}

export function vhostFormOf(vhost: Namespace): VhostForm {
  return {
    name: vhost.name,
    description: vhost.description,
    tags: (vhost.tags ?? []).join(", "),
    defaultQueueType: vhost.defaultQueueType,
    tracing: vhost.tracing,
  };
}

export function toNamespaceInput(form: VhostForm): NamespaceInput {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    tags: form.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag !== ""),
    defaultQueueType: form.defaultQueueType,
    tracing: form.tracing,
  };
}

export function validateVhost(form: VhostForm, t: (key: string) => string): string | null {
  if (form.name.trim() === "") return t("board.vhosts.rabbitmq.nameRequired");
  return null;
}

/**
 * Creating or editing a virtual host.
 *
 * Unlike a queue or an exchange, a vhost's settings genuinely can change: the
 * broker spells create and update as one idempotent call, so this dialog does
 * both and the name is what decides which.
 */
export function VhostDialog({
  open,
  editing,
  onClose,
  onSubmit,
}: {
  open: boolean;
  editing?: Namespace;
  onClose: () => void;
  onSubmit: (input: NamespaceInput) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<VhostForm>(emptyVhostForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(editing != null ? vhostFormOf(editing) : emptyVhostForm());
    setError(null);
    setSaving(false);
  }, [editing, open]);

  const set = <K extends keyof VhostForm>(key: K, value: VhostForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const invalid = useMemo(() => validateVhost(form, t), [form, t]);

  const save = async () => {
    if (invalid != null) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(toNamespaceInput(form));
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
            {t(editing != null ? "board.vhosts.rabbitmq.edit" : "board.vhosts.rabbitmq.new")}
          </DialogTitle>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="vhost-name">{t("board.vhosts.rabbitmq.name")}</FieldLabel>
            <Input
              id="vhost-name"
              className="mono3"
              value={form.name}
              placeholder="/orders"
              // The name is the identity: changing it on an edit would create
              // a second virtual host rather than rename the first.
              disabled={editing != null}
              onChange={(event) => set("name", event.target.value)}
            />
            <FieldDescription>
              {t(
                editing != null
                  ? "board.vhosts.rabbitmq.nameFixed"
                  : "board.vhosts.rabbitmq.nameHint",
              )}
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="vhost-desc">
              {t("board.vhosts.rabbitmq.description")}
            </FieldLabel>
            <Input
              id="vhost-desc"
              value={form.description}
              onChange={(event) => set("description", event.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel>{t("board.vhosts.rabbitmq.defaultQueueType")}</FieldLabel>
            <Segmented
              block
              value={form.defaultQueueType}
              onChange={(next: string) => set("defaultQueueType", next)}
              options={DEFAULT_TYPES.map((type) => ({
                value: type.value,
                label: type.value === "" ? t(type.label) : type.label,
              }))}
            />
            <FieldDescription>
              {t("board.vhosts.rabbitmq.defaultQueueTypeHint")}
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="vhost-tags">{t("board.vhosts.rabbitmq.tags")}</FieldLabel>
            <Input
              id="vhost-tags"
              value={form.tags}
              placeholder="production, orders"
              onChange={(event) => set("tags", event.target.value)}
            />
            <FieldDescription>{t("board.vhosts.rabbitmq.tagsHint")}</FieldDescription>
          </Field>

          <Field orientation="horizontal">
            <FieldLabel htmlFor="vhost-tracing">
              {t("board.vhosts.rabbitmq.tracing")}
            </FieldLabel>
            <Switch
              id="vhost-tracing"
              checked={form.tracing}
              onCheckedChange={(next: boolean) => set("tracing", next)}
            />
          </Field>
          <FieldDescription>{t("board.vhosts.rabbitmq.tracingHint")}</FieldDescription>
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
