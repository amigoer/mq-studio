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
import { formatErrorMessage } from "@/lib/utils";

/**
 * What a reset does, which is three different things.
 *
 * They are one control because Pulsar reaches them through one request shape,
 * and three options because they have opposite effects: replaying hands a
 * consumer everything again, skipping throws the backlog away, and a timestamp
 * is the one that needs a value.
 */
export const ResetMode = {
  Earliest: "earliest",
  Timestamp: "timestamp",
  Skip: "skip",
} as const;
export type ResetModeValue = (typeof ResetMode)[keyof typeof ResetMode];

export interface PulsarResetForm {
  mode: ResetModeValue;
  /** A local datetime-local value, only read when the mode is a timestamp. */
  at: string;
}

export function emptyResetForm(): PulsarResetForm {
  return { mode: ResetMode.Earliest, at: "" };
}

/**
 * The request a reset will send, or the reason it will not.
 *
 * Exported so the mapping is testable without a DOM: the three modes reach
 * three different endpoints and getting one wrong is silent - a skip that
 * replayed would hand a consumer a backlog somebody asked to discard.
 */
export function toRequest(
  form: PulsarResetForm,
): { timestamp: number; force: boolean } | { error: "timeRequired" | "timeInvalid" } {
  if (form.mode === ResetMode.Skip) return { timestamp: 0, force: true };
  if (form.mode === ResetMode.Earliest) return { timestamp: 0, force: false };

  if (form.at.trim() === "") return { error: "timeRequired" };
  const at = new Date(form.at).getTime();
  if (Number.isNaN(at)) return { error: "timeInvalid" };
  return { timestamp: at, force: false };
}

/**
 * Move a subscription's cursor.
 *
 * Every option here changes what a running consumer receives next, which is
 * why the consequence is spelled out under the choice rather than left in a
 * tooltip: replaying can redeliver thousands of messages to a consumer that
 * already handled them, and skipping discards a backlog nothing else can get
 * back.
 */
export function ResetCursorDialogPulsar({
  open,
  topic,
  subscription,
  backlog,
  onClose,
  onSubmit,
}: {
  open: boolean;
  topic: string;
  subscription: string;
  /** What is about to be replayed or discarded, so the number is on screen. */
  backlog: number | null;
  onClose: () => void;
  onSubmit: (timestamp: number, force: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<PulsarResetForm>(emptyResetForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(emptyResetForm());
    setError(null);
    setSaving(false);
  }, [open]);

  const request = toRequest(form);
  const invalid =
    "error" in request ? t(`board.consumers.pulsar.${request.error}`) : null;

  const save = async () => {
    if ("error" in request) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(request.timestamp, request.force);
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
          <DialogTitle>{t("board.consumers.pulsar.resetTitle")}</DialogTitle>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel>{t("board.consumers.pulsar.subscription")}</FieldLabel>
            <Input className="mono3" value={`${subscription} · ${topic}`} disabled />
          </Field>

          <Field>
            <FieldLabel>{t("board.consumers.pulsar.resetMode")}</FieldLabel>
            <Segmented<ResetModeValue>
              className="self-start"
              value={form.mode}
              onChange={(next) => setForm((previous) => ({ ...previous, mode: next }))}
              options={[
                { value: ResetMode.Earliest, label: t("board.consumers.pulsar.replayAll") },
                { value: ResetMode.Timestamp, label: t("board.consumers.pulsar.replayFrom") },
                { value: ResetMode.Skip, label: t("board.consumers.pulsar.skipAll") },
              ]}
            />
            <FieldDescription>
              {form.mode === ResetMode.Skip
                ? t("board.consumers.pulsar.skipHint", { count: backlog ?? 0 })
                : form.mode === ResetMode.Earliest
                  ? t("board.consumers.pulsar.replayAllHint")
                  : t("board.consumers.pulsar.replayFromHint")}
            </FieldDescription>
          </Field>

          {form.mode === ResetMode.Timestamp && (
            <Field>
              <FieldLabel htmlFor="reset-at">{t("board.consumers.pulsar.at")}</FieldLabel>
              <Input
                id="reset-at"
                type="datetime-local"
                value={form.at}
                onChange={(event) =>
                  setForm((previous) => ({ ...previous, at: event.target.value }))
                }
              />
            </Field>
          )}
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
          <Button
            variant={form.mode === ResetMode.Skip ? "destructive" : "default"}
            disabled={invalid != null || saving}
            onClick={() => void save()}
          >
            {saving && <Spinner />}
            {t("board.consumers.pulsar.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
