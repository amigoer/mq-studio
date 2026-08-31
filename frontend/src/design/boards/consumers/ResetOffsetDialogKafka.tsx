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
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { SelectField, WarnBanner, useToast } from "@/components";
import { resetKafkaGroupOffsets, type KafkaOffsetTarget } from "@/api/kafka";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { formatErrorMessage } from "@/lib/utils";

export interface ResetOffsetDraft {
  topic: string;
  target: KafkaOffsetTarget;
  /** A local datetime string, as the input gives it. */
  timestamp: string;
  /** The offset, or the signed delta for a shift. */
  value: string;
}

export function emptyResetOffsetDraft(topic = ""): ResetOffsetDraft {
  return { topic, target: "latest", timestamp: "", value: "" };
}

/**
 * What the form will not send.
 *
 * Each target needs a different field, and validating them together is what
 * stops a reset to "offset" going out with no offset in it - which Kafka would
 * accept as offset zero and replay the whole topic.
 */
export function validateResetOffsetDraft(draft: ResetOffsetDraft): string | null {
  if (draft.topic.trim() === "") return "topicRequired";
  if (draft.target === "timestamp") {
    if (draft.timestamp.trim() === "") return "timestampRequired";
    if (Number.isNaN(Date.parse(draft.timestamp))) return "timestampInvalid";
  }
  if (draft.target === "offset" || draft.target === "shift") {
    if (draft.value.trim() === "") return "valueRequired";
    if (!/^[+-]?\d+$/.test(draft.value.trim())) return "valueInvalid";
    // An absolute offset cannot be negative; a shift is signed on purpose.
    if (draft.target === "offset" && Number.parseInt(draft.value, 10) < 0) {
      return "valueNegative";
    }
    if (draft.target === "shift" && Number.parseInt(draft.value, 10) === 0) {
      return "shiftZero";
    }
  }
  return null;
}

/** The draft as the bridge takes it. */
export function toResetInput(group: string, draft: ResetOffsetDraft) {
  return {
    group,
    topic: draft.topic.trim(),
    partitions: [] as number[],
    target: draft.target,
    timestamp: draft.target === "timestamp" ? Date.parse(draft.timestamp) : 0,
    value:
      draft.target === "offset" || draft.target === "shift"
        ? Number.parseInt(draft.value, 10)
        : 0,
  };
}

export function ResetOffsetDialogKafka({
  open,
  group,
  topics,
  hasMembers,
  onClose,
  onReset,
}: {
  open: boolean;
  group: string;
  topics: string[];
  /** Kafka refuses a reset while anything is connected. */
  hasMembers: boolean;
  onClose: () => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const { id: connID } = useConnectionScope();
  const toast = useToast();
  const [draft, setDraft] = useState<ResetOffsetDraft>(() => emptyResetOffsetDraft(topics[0]));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDraft(emptyResetOffsetDraft(topics[0] ?? ""));
  }, [open, topics]);

  const set = <K extends keyof ResetOffsetDraft>(key: K, value: ResetOffsetDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const problem = useMemo(() => validateResetOffsetDraft(draft), [draft]);

  const save = async () => {
    if (problem != null || hasMembers) return;
    setSaving(true);
    try {
      await resetKafkaGroupOffsets(connID, toResetInput(group, draft));
      toast.success(t("board.consumers.kafka.resetDone", { group }));
      onReset();
      onClose();
    } catch (failure) {
      toast.error(formatErrorMessage(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex flex-col gap-3.5 sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t("board.consumers.kafka.resetTitle", { group })}</DialogTitle>
        </DialogHeader>

        {/* Said before the attempt, not after it fails. Kafka will not write a
            group's offsets while its members hold the partitions, and the fix
            is to stop the consumers. */}
        {hasMembers && <WarnBanner>{t("board.consumers.kafka.resetNeedsStop")}</WarnBanner>}

        <Field label="Topic">
          <SelectField
            value={draft.topic}
            placeholder={t("board.consumers.kafka.pickTopic")}
            options={topics.map((topic) => ({ value: topic }))}
            onValueChange={(next) => set("topic", next)}
          />
        </Field>
        <Field label={t("board.consumers.kafka.target")}>
          <SelectField<KafkaOffsetTarget>
            value={draft.target}
            options={[
              { value: "earliest", label: t("board.consumers.kafka.targetEarliest") },
              { value: "latest", label: t("board.consumers.kafka.targetLatest") },
              { value: "timestamp", label: t("board.consumers.kafka.targetTimestamp") },
              { value: "offset", label: t("board.consumers.kafka.targetOffset") },
              { value: "shift", label: t("board.consumers.kafka.targetShift") },
            ]}
            onValueChange={(next) => set("target", next)}
          />
        </Field>
        {draft.target === "timestamp" && (
          <Field
            label={t("board.consumers.kafka.timestamp")}
            hint={t("board.consumers.kafka.timestampHint")}
          >
            <Input
              type="datetime-local"
              value={draft.timestamp}
              onChange={(event) => set("timestamp", event.target.value)}
            />
          </Field>
        )}
        {(draft.target === "offset" || draft.target === "shift") && (
          <Field
            label={
              draft.target === "offset"
                ? t("board.consumers.kafka.offset")
                : t("board.consumers.kafka.shift")
            }
            hint={
              draft.target === "offset"
                ? t("board.consumers.kafka.offsetHint")
                : t("board.consumers.kafka.shiftHint")
            }
          >
            <Input
              className="mono3"
              value={draft.value}
              placeholder={draft.target === "shift" ? "-100" : "0"}
              onChange={(event) => set("value", event.target.value)}
            />
          </Field>
        )}

        <DialogFooter className="items-center">
          <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>
            {t("board.consumers.kafka.clampNote")}
          </span>
          <span className="flex-1" />
          {problem != null && (
            <span className="max-w-64 text-right text-xs text-muted-foreground">
              {t(`board.consumers.kafka.invalid.${problem}`)}
            </span>
          )}
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={problem != null || hasMembers || saving} onClick={() => void save()}>
            {saving && <Spinner />}
            {t("board.consumers.kafka.reset")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 text-xs">
      <span className="font-medium">
        {label} {hint != null && <span className="font-normal text-(--c-muted-2)">{hint}</span>}
      </span>
      {children}
    </div>
  );
}
