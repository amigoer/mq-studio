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
import { KV } from "@/components";
import { formatErrorMessage } from "@/lib/utils";

/** The row this dialog was opened from. */
export interface QueueTarget {
  topic: string;
  brokerName: string;
  queueId: number;
  consumerOffset: number;
  brokerOffset: number;
}

/**
 * Move one queue's read position to an exact offset.
 *
 * Not a reset: a reset names a moment and lets the broker find a position per
 * queue, which is the right gesture for a whole group. This is the surgical
 * one — the queue whose backlog is on screen, moved past a message nobody can
 * consume — so the dialog shows where it is now and what the queue's own range
 * is, and lets the number be typed against that.
 *
 * The range is shown but not enforced. Past the end skips what has not arrived
 * yet, before the start is pulled forward by the broker on the next fetch, and
 * both are things an operator does on purpose.
 */
export function QueueOffsetDialog({
  open,
  group,
  target,
  onClose,
  onSubmit,
}: {
  open: boolean;
  group: string;
  /** Undefined closes the dialog. */
  target: QueueTarget | undefined;
  onClose: () => void;
  onSubmit: (target: QueueTarget, offset: number) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [offset, setOffset] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || target == null) return;
    setOffset(String(target.consumerOffset));
    setError(null);
    setSaving(false);
  }, [open, target]);

  const parsed = Number(offset);
  const invalid =
    offset.trim() === "" || !Number.isInteger(parsed) || parsed < 0
      ? t("board.consumers.rocketmq.queueOffset.invalid")
      : null;

  const save = async () => {
    if (invalid != null || target == null) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(target, parsed);
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
          <DialogTitle>{t("board.consumers.rocketmq.queueOffset.title")}</DialogTitle>
        </DialogHeader>

        {target != null && (
          <KV
            rows={[
              [t("board.common.consumerGroup"), group],
              ["Topic", target.topic],
              [
                t("board.common.queue"),
                `${target.brokerName} q${target.queueId}`,
              ],
              [
                t("board.consumers.rocketmq.queueOffset.range"),
                `${target.consumerOffset.toLocaleString()} / ${target.brokerOffset.toLocaleString()}`,
              ],
            ]}
          />
        )}

        <FieldGroup className="gap-3">
          <Field>
            <FieldLabel htmlFor="queue-offset">
              {t("board.consumers.rocketmq.queueOffset.newOffset")}
            </FieldLabel>
            <Input
              id="queue-offset"
              className="mono3"
              inputMode="numeric"
              value={offset}
              onChange={(event) => setOffset(event.target.value)}
            />
          </Field>
        </FieldGroup>

        <FieldDescription className="text-xs">
          {t("board.consumers.rocketmq.queueOffset.note")}
        </FieldDescription>

        <DialogFooter className="items-center">
          <span className="text-xs text-muted-foreground">
            {t("board.consumers.rocketmq.queueOffset.risky")}
          </span>
          <span className="flex-1" />
          {(invalid ?? error) != null && (
            <span
              className={
                "max-w-64 text-right text-xs " +
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
