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
import { Switch } from "@/components/ui/switch";
import { Segmented, SelectField } from "@/components";
import { groupName, subscriptionsOf } from "@/mq/rocketmq/subscriptions";
import type { Subscription } from "@/api/models";
import { formatErrorMessage } from "@/lib/utils";

/** Where to move the group's read position to. */
const TARGETS = [
  { value: "earliest", label: "board.consumers.rocketmq.reset.earliest" },
  { value: "latest", label: "board.consumers.rocketmq.reset.latest" },
  { value: "at", label: "board.consumers.rocketmq.reset.at" },
] as const;
type Target = (typeof TARGETS)[number]["value"];

/** `2026-08-30T10:24` — what a datetime-local input round-trips. */
function localInputValue(at: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/**
 * Move a consumer group's read position.
 *
 * RocketMQ resets by timestamp, not by offset: the broker finds the first
 * message stored at or after the moment given, per queue. Timestamp 0 is the
 * earliest message still retained, which is as far back as a reset can go -
 * anything older has already been rolled off the commit log.
 */
export function ResetOffsetDialog({
  open,
  group,
  onClose,
  onSubmit,
}: {
  open: boolean;
  group: Subscription | undefined;
  onClose: () => void;
  onSubmit: (topic: string, timestamp: number, force: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const topics = group == null ? [] : subscriptionsOf(group).map((one) => one.topic);

  const [topic, setTopic] = useState("");
  const [target, setTarget] = useState<Target>("earliest");
  const [at, setAt] = useState(() => localInputValue(new Date()));
  const [force, setForce] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTopic(topics[0] ?? "");
    setTarget("earliest");
    setAt(localInputValue(new Date()));
    setForce(true);
    setError(null);
    setSaving(false);
    // Reopening on a different group has to start from that group's topics.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, open]);

  const timestampOf = (): number => {
    if (target === "earliest") return 0;
    if (target === "latest") return Date.now();
    const parsed = new Date(at).getTime();
    return Number.isNaN(parsed) ? Date.now() : parsed;
  };

  const invalid =
    topic.trim() === ""
      ? t("board.consumers.rocketmq.reset.topicRequired")
      : target === "at" && Number.isNaN(new Date(at).getTime())
        ? t("board.consumers.rocketmq.reset.timeInvalid")
        : null;

  const save = async () => {
    if (invalid != null) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(topic.trim(), timestampOf(), force);
      onClose();
    } catch (failure) {
      setError(formatErrorMessage(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t("board.common.resetOffset")}</DialogTitle>
        </DialogHeader>

        <FieldGroup className="gap-3">
          <Field>
            <FieldLabel>
              {t("board.common.consumerGroup")}{" "}
              <span className="mono3 font-normal text-(--c-fg-2)">
                {group == null ? "—" : groupName(group)}
              </span>
            </FieldLabel>
          </Field>

          <Field>
            <FieldLabel>Topic</FieldLabel>
            {topics.length > 0 ? (
            <SelectField
              size="default"
              className="w-full"
              value={topic}
              onValueChange={setTopic}
              placeholder={t("board.messages.rocketmq.pickTopic")}
              options={topics.map((name) => ({ value: name }))}
            />
          ) : (
            /* A group with no client connected reports no subscriptions, so the
               topic has to be typed rather than picked. */
            <Input
              className="mono3"
              value={topic}
              placeholder={t("board.consumers.rocketmq.reset.topicPlaceholder")}
              onChange={(event) => setTopic(event.target.value)}
            />
          )}
          </Field>

          <Field>
            <FieldLabel>{t("board.consumers.rocketmq.reset.target")}</FieldLabel>
            <Segmented
              className="self-start"
              value={target}
              onChange={(next: Target) => setTarget(next)}
              options={TARGETS.map((one) => ({ value: one.value, label: t(one.label) }))}
            />
          </Field>

          {target === "at" && (
            <Field>
              <FieldLabel htmlFor="reset-at">{t("board.consumers.rocketmq.reset.at")}</FieldLabel>
              <Input
                id="reset-at"
                type="datetime-local"
                value={at}
                onChange={(event) => setAt(event.target.value)}
              />
            </Field>
          )}

          <Field>
            <label className="flex items-center gap-1.5 text-sm">
              <Switch checked={force} onCheckedChange={setForce} />
              {t("board.consumers.rocketmq.reset.force")}
            </label>
          </Field>
        </FieldGroup>

        <FieldDescription className="text-xs">
          {t("board.consumers.rocketmq.reset.note")}
        </FieldDescription>

        <DialogFooter className="items-center">
          <span className="text-xs text-muted-foreground">
            {t("board.consumers.rocketmq.reset.risky")}
          </span>
          <span className="flex-1" />
          {(invalid ?? error) != null && (
            <span
              className={
                "max-w-72 text-right text-xs " +
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
            {t("board.common.resetOffset")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
