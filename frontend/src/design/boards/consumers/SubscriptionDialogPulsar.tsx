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
import { Segmented, SelectField } from "@/components";
import { StartAt, validateSubscriptionName, type StartAtValue } from "@/mq/pulsar/subscriptions";
import { formatErrorMessage } from "@/lib/utils";

export interface PulsarSubscriptionForm {
  topic: string;
  name: string;
  startAt: StartAtValue;
}

export function emptySubscriptionForm(topic = ""): PulsarSubscriptionForm {
  return { topic, name: "", startAt: StartAt.Earliest };
}

/** The reason the form cannot be saved, or null. Exported to be testable. */
export function validate(
  form: PulsarSubscriptionForm,
  t: (key: string) => string,
): string | null {
  if (form.topic.trim() === "") return t("board.consumers.pulsar.topicRequired");
  return validateSubscriptionName(form.name, t);
}

/**
 * Create a Pulsar subscription.
 *
 * Creating one before any consumer attaches is the point: a subscription is a
 * cursor the broker stores, so making it early is how a consumer that has not
 * started yet stops missing everything published before it does.
 *
 * Which is also why the position matters and is not hidden. Starting at the
 * latest silently discards whatever is already on the topic - the opposite of
 * why somebody creates a subscription ahead of time - so earliest is the
 * default and the other option says what it costs.
 */
export function SubscriptionDialogPulsar({
  open,
  topics,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** The topics in the current namespace, for the picker. */
  topics: string[];
  onClose: () => void;
  onSubmit: (form: PulsarSubscriptionForm) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<PulsarSubscriptionForm>(() => emptySubscriptionForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(emptySubscriptionForm(topics[0] ?? ""));
    setError(null);
    setSaving(false);
  }, [open, topics]);

  const set = <K extends keyof PulsarSubscriptionForm>(
    key: K,
    value: PulsarSubscriptionForm[K],
  ) => setForm((previous) => ({ ...previous, [key]: value }));

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
          <DialogTitle>{t("board.consumers.pulsar.newTitle")}</DialogTitle>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel>{t("board.consumers.pulsar.topic")}</FieldLabel>
            {/* A subscription belongs to exactly one topic and is named only
                within it, so the topic is half its identity rather than a
                setting on it. */}
            <SelectField
              className="w-full"
              value={form.topic}
              options={topics.map((topic) => ({ value: topic, label: topic }))}
              onValueChange={(next) => set("topic", next)}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="subscription-name">
              {t("board.consumers.pulsar.name")}
            </FieldLabel>
            <Input
              id="subscription-name"
              className="mono3"
              value={form.name}
              placeholder="order-processor"
              onChange={(event) => set("name", event.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel>{t("board.consumers.pulsar.startAt")}</FieldLabel>
            <Segmented<StartAtValue>
              className="self-start"
              value={form.startAt}
              onChange={(next) => set("startAt", next)}
              options={[
                { value: StartAt.Earliest, label: t("board.consumers.pulsar.earliest") },
                { value: StartAt.Latest, label: t("board.consumers.pulsar.latest") },
              ]}
            />
            <FieldDescription>
              {form.startAt === StartAt.Earliest
                ? t("board.consumers.pulsar.earliestHint")
                : t("board.consumers.pulsar.latestHint")}
            </FieldDescription>
          </Field>
        </FieldGroup>

        <FieldDescription className="text-xs">
          {t("board.consumers.pulsar.typeNote")}
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
