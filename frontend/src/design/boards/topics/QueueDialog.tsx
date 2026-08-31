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
import { Segmented, SelectField } from "@/components";
import { formatErrorMessage } from "@/lib/utils";
import type { QueueDeclaration } from "@/api/rabbitmq";

/**
 * The queue types, and what choosing one commits to.
 *
 * Not a cosmetic choice and not changeable afterwards: the type is fixed at
 * declaration, so the only way to move a queue between them is to drain it,
 * delete it and declare it again.
 */
const TYPES = [
  { value: "quorum", label: "quorum" },
  { value: "classic", label: "classic" },
  { value: "stream", label: "stream" },
] as const;

/** Overflow decides what a full queue does, and the default drops the oldest. */
const OVERFLOW = ["drop-head", "reject-publish", "reject-publish-dlx"] as const;

export interface QueueForm {
  name: string;
  vhost: string;
  queueType: string;
  durable: boolean;
  autoDelete: boolean;
  messageTtlMs: string;
  expiresMs: string;
  maxLength: string;
  maxLengthBytes: string;
  overflow: string;
  deadLetterExchange: string;
  deadLetterRoutingKey: string;
  singleActiveConsumer: boolean;
}

export function emptyQueueForm(vhost: string): QueueForm {
  return {
    name: "",
    vhost,
    // Quorum by default. A classic queue lives on one node and is lost with
    // it, and choosing that has to be deliberate rather than the fallback.
    queueType: "quorum",
    durable: true,
    autoDelete: false,
    messageTtlMs: "",
    expiresMs: "",
    maxLength: "",
    maxLengthBytes: "",
    overflow: "",
    deadLetterExchange: "",
    deadLetterRoutingKey: "",
    singleActiveConsumer: false,
  };
}

/**
 * Turns the form into the declaration the broker receives.
 *
 * Arguments travel as JSON so their types survive: RabbitMQ rejects a float
 * where it wants an integer and a string where it wants either, and an empty
 * field means "do not set this argument" rather than "set it to zero" - a
 * max-length of zero is a queue that can hold nothing.
 */
export function toDeclaration(form: QueueForm): QueueDeclaration {
  const args: Record<string, unknown> = {};
  const number = (key: string, raw: string) => {
    const value = Number.parseInt(raw.trim(), 10);
    if (raw.trim() !== "" && !Number.isNaN(value)) args[key] = value;
  };
  const text = (key: string, raw: string) => {
    if (raw.trim() !== "") args[key] = raw.trim();
  };

  number("x-message-ttl", form.messageTtlMs);
  number("x-expires", form.expiresMs);
  number("x-max-length", form.maxLength);
  number("x-max-length-bytes", form.maxLengthBytes);
  text("x-overflow", form.overflow);
  text("x-dead-letter-exchange", form.deadLetterExchange);
  text("x-dead-letter-routing-key", form.deadLetterRoutingKey);
  if (form.singleActiveConsumer) args["x-single-active-consumer"] = true;

  return {
    vhost: form.vhost,
    name: form.name.trim(),
    queueType: form.queueType,
    // A stream is a log on disk; a transient one is a contradiction the broker
    // rejects, so the form settles it rather than letting the broker refuse.
    durable: form.queueType === "stream" ? true : form.durable,
    autoDelete: form.autoDelete,
    arguments: JSON.stringify(args),
  };
}

/** What the form will not let through, in the words the user needs. */
export function validate(form: QueueForm, t: (key: string) => string): string | null {
  if (form.name.trim() === "") return t("board.topics.rabbitmq.nameRequired");
  // The broker reserves this prefix for itself.
  if (form.name.trim().startsWith("amq.")) return t("board.topics.rabbitmq.nameReserved");
  if (form.deadLetterRoutingKey.trim() !== "" && form.deadLetterExchange.trim() === "") {
    return t("board.topics.rabbitmq.dlxRoutingKeyNeedsExchange");
  }
  return null;
}

/**
 * Declaring a queue.
 *
 * There is no edit twin, unlike the topic dialog. A queue's type, durability
 * and arguments are fixed at declaration on RabbitMQ - re-declaring with
 * different ones is a channel error, not an update - and the way to change a
 * live queue's behaviour is a policy, which is its own page.
 */
export function QueueDialog({
  open,
  vhost,
  onClose,
  onSubmit,
}: {
  open: boolean;
  vhost: string;
  onClose: () => void;
  onSubmit: (declaration: QueueDeclaration) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<QueueForm>(() => emptyQueueForm(vhost));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(emptyQueueForm(vhost));
    setError(null);
    setSaving(false);
  }, [open, vhost]);

  const set = <K extends keyof QueueForm>(key: K, value: QueueForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const invalid = useMemo(() => validate(form, t), [form, t]);
  const isStream = form.queueType === "stream";

  const save = async () => {
    if (invalid != null) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(toDeclaration(form));
      onClose();
    } catch (saveError) {
      setError(formatErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3.5 overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t("board.topics.rabbitmq.newQueue")}</DialogTitle>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="queue-name">{t("board.common.queue")}</FieldLabel>
            <Input
              id="queue-name"
              value={form.name}
              placeholder="order.settle.q"
              onChange={(event) => set("name", event.target.value)}
            />
            <FieldDescription>{t("board.topics.rabbitmq.nameHint", { vhost })}</FieldDescription>
          </Field>

          <Field>
            <FieldLabel>{t("board.common.type")}</FieldLabel>
            <Segmented
              block
              value={form.queueType}
              onChange={(next: string) => set("queueType", next)}
              options={TYPES.map((type) => ({ ...type }))}
            />
            <FieldDescription>
              {t(`board.topics.rabbitmq.typeHint.${form.queueType}`)}
            </FieldDescription>
          </Field>

          <Field orientation="horizontal">
            <FieldLabel htmlFor="queue-durable">
              {t("board.common.persistence")}
            </FieldLabel>
            <Switch
              id="queue-durable"
              checked={isStream ? true : form.durable}
              // A stream is a log on disk. Offering to make one transient
              // would be offering something the broker refuses.
              disabled={isStream}
              onCheckedChange={(next: boolean) => set("durable", next)}
            />
          </Field>

          <Field orientation="horizontal">
            <FieldLabel htmlFor="queue-autodelete">
              {t("board.topics.rabbitmq.autoDelete")}
            </FieldLabel>
            <Switch
              id="queue-autodelete"
              checked={form.autoDelete}
              onCheckedChange={(next: boolean) => set("autoDelete", next)}
            />
          </Field>
          <FieldDescription>{t("board.topics.rabbitmq.autoDeleteHint")}</FieldDescription>

          <Field>
            <FieldLabel htmlFor="queue-dlx">{t("board.topics.rabbitmq.dlx")}</FieldLabel>
            <Input
              id="queue-dlx"
              className="mono3"
              value={form.deadLetterExchange}
              placeholder="dlx.order"
              onChange={(event) => set("deadLetterExchange", event.target.value)}
            />
            <FieldDescription>{t("board.topics.rabbitmq.dlxHint")}</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="queue-dlrk">
              {t("board.topics.rabbitmq.dlxRoutingKey")}
            </FieldLabel>
            <Input
              id="queue-dlrk"
              className="mono3"
              value={form.deadLetterRoutingKey}
              onChange={(event) => set("deadLetterRoutingKey", event.target.value)}
            />
            <FieldDescription>
              {t("board.topics.rabbitmq.dlxRoutingKeyHint")}
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="queue-ttl">{t("board.topics.rabbitmq.messageTtl")}</FieldLabel>
            <Input
              id="queue-ttl"
              type="number"
              min={0}
              value={form.messageTtlMs}
              placeholder={t("board.topics.rabbitmq.unlimited")}
              onChange={(event) => set("messageTtlMs", event.target.value)}
            />
            <FieldDescription>{t("board.topics.rabbitmq.messageTtlHint")}</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="queue-expires">{t("board.topics.rabbitmq.expires")}</FieldLabel>
            <Input
              id="queue-expires"
              type="number"
              min={0}
              value={form.expiresMs}
              placeholder={t("board.topics.rabbitmq.never")}
              onChange={(event) => set("expiresMs", event.target.value)}
            />
            <FieldDescription>{t("board.topics.rabbitmq.expiresHint")}</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="queue-maxlen">{t("board.topics.rabbitmq.maxLength")}</FieldLabel>
            <Input
              id="queue-maxlen"
              type="number"
              min={0}
              value={form.maxLength}
              placeholder={t("board.topics.rabbitmq.unlimited")}
              onChange={(event) => set("maxLength", event.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="queue-maxbytes">
              {t("board.topics.rabbitmq.maxLengthBytes")}
            </FieldLabel>
            <Input
              id="queue-maxbytes"
              type="number"
              min={0}
              value={form.maxLengthBytes}
              placeholder={t("board.topics.rabbitmq.unlimited")}
              onChange={(event) => set("maxLengthBytes", event.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel>{t("board.topics.rabbitmq.overflow")}</FieldLabel>
            <SelectField
              value={form.overflow}
              onValueChange={(next) => set("overflow", next)}
              options={[
                { value: "", label: t("board.topics.rabbitmq.overflowDefault") },
                ...OVERFLOW.map((value) => ({ value })),
              ]}
            />
            <FieldDescription>{t("board.topics.rabbitmq.overflowHint")}</FieldDescription>
          </Field>

          <Field orientation="horizontal">
            <FieldLabel htmlFor="queue-sac">
              {t("board.topics.rabbitmq.singleActive")}
            </FieldLabel>
            <Switch
              id="queue-sac"
              checked={form.singleActiveConsumer}
              onCheckedChange={(next: boolean) => set("singleActiveConsumer", next)}
            />
          </Field>
          <FieldDescription>{t("board.topics.rabbitmq.singleActiveHint")}</FieldDescription>
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
            {t("board.topics.rabbitmq.declare")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
