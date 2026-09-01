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
import { Segmented } from "@/components";
import { parsePartitions, validateTopicName } from "@/mq/pulsar/destinations";
import { formatErrorMessage } from "@/lib/utils";

export interface PulsarTopicForm {
  name: string;
  /** Blank is zero, which is a non-partitioned topic rather than a default. */
  partitions: string;
  persistent: boolean;
}

export function emptyTopicForm(): PulsarTopicForm {
  return { name: "", partitions: "", persistent: true };
}

/**
 * The reason the form cannot be saved, or null.
 *
 * Exported so the rules are testable without a DOM, and so the two that are
 * genuinely Pulsar's - the scheme belongs to the storage switch, and a
 * "-partition-N" suffix shadows a real partition - are stated once.
 */
export function validate(
  form: PulsarTopicForm,
  t: (key: string) => string,
): string | null {
  const name = validateTopicName(form.name, t);
  if (name != null) return name;
  if ("error" in parsePartitions(form.partitions)) {
    return t("board.topics.pulsar.partitionsInvalid");
  }
  return null;
}

/**
 * Create a Pulsar topic.
 *
 * The two decisions here cannot be taken back. Partitions can be raised later
 * but never lowered, and a topic created without them can never become
 * partitioned; a non-persistent topic keeps nothing on disk, so a message
 * nobody is connected to receive is dropped. Both are stated on the form
 * rather than left to be discovered.
 */
export function TopicDialogPulsar({
  open,
  namespace,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** The tenant/namespace the topic is created in, from the page's cascade. */
  namespace: string;
  onClose: () => void;
  onSubmit: (form: PulsarTopicForm) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<PulsarTopicForm>(emptyTopicForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(emptyTopicForm());
    setError(null);
    setSaving(false);
  }, [open]);

  const set = <K extends keyof PulsarTopicForm>(key: K, value: PulsarTopicForm[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const invalid = validate(form, t);

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
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t("board.topics.pulsar.newTitle")}</DialogTitle>
        </DialogHeader>

        <FieldGroup className="grid grid-cols-2 gap-x-3.5 gap-y-3">
          <Field className="col-span-2">
            <FieldLabel htmlFor="topic-namespace">
              {t("board.topics.pulsar.namespace")}
            </FieldLabel>
            {/* Chosen by the page's cascade, not here: a topic created in a
                different namespace would be invisible to the list it was
                created from. */}
            <Input id="topic-namespace" className="mono3" value={namespace} disabled />
          </Field>

          <Field className="col-span-2">
            <FieldLabel htmlFor="topic-name">{t("board.topics.pulsar.name")}</FieldLabel>
            <Input
              id="topic-name"
              className="mono3"
              value={form.name}
              placeholder="order-created"
              onChange={(event) => set("name", event.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="topic-partitions">
              {t("board.topics.pulsar.partitions")}
            </FieldLabel>
            <Input
              id="topic-partitions"
              className="mono3"
              value={form.partitions}
              placeholder="0"
              onChange={(event) => set("partitions", event.target.value)}
            />
            <FieldDescription>{t("board.topics.pulsar.partitionsHint")}</FieldDescription>
          </Field>

          <Field>
            <FieldLabel>{t("board.topics.pulsar.storage")}</FieldLabel>
            <Segmented<string>
              className="self-start"
              value={form.persistent ? "persistent" : "non-persistent"}
              onChange={(next) => set("persistent", next === "persistent")}
              options={[
                { value: "persistent", label: "persistent" },
                { value: "non-persistent", label: "non-persistent" },
              ]}
            />
            <FieldDescription>
              {form.persistent
                ? t("board.topics.pulsar.persistentHint")
                : t("board.topics.pulsar.nonPersistentHint")}
            </FieldDescription>
          </Field>
        </FieldGroup>

        <FieldDescription className="text-xs">
          {t("board.topics.pulsar.oneWayNote")}
        </FieldDescription>

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
