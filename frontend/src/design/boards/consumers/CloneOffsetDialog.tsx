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
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { SelectField } from "@/components";
import { groupName, subscriptionsOf } from "@/mq/rocketmq/subscriptions";
import type { Subscription } from "@/api/models";
import { formatErrorMessage } from "@/lib/utils";

/** A Select item cannot carry the empty string, so "every topic" gets one. */
const ALL_TOPICS = "__all_topics__";

/**
 * Hand one consumer group another's read positions.
 *
 * Not a reset: a reset moves a group in time and the broker finds the first
 * message after that moment, per queue. This writes the target group the
 * source's exact per-queue offsets, which is what standing up a replacement
 * group without replaying everything the old one handled actually needs.
 *
 * Reading the source offline is the ordinary case, not the exception — during
 * a migration the group being replaced is already shut down — so the switch
 * starts on for a source with nothing connected.
 */
export function CloneOffsetDialog({
  open,
  source,
  groups,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** The group whose positions are copied. Undefined closes the dialog. */
  source: Subscription | undefined;
  /** Every group, so the target can be picked from the ones that are not it. */
  groups: readonly Subscription[];
  onClose: () => void;
  onSubmit: (to: string, destination: string, fromOffline: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const from = source == null ? "" : groupName(source);
  const topics = source == null ? [] : subscriptionsOf(source).map((one) => one.topic);
  const targets = groups.map(groupName).filter((name) => name !== from);

  const [to, setTo] = useState("");
  const [topic, setTopic] = useState(ALL_TOPICS);
  const [fromOffline, setFromOffline] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTo("");
    setTopic(ALL_TOPICS);
    // A source with a client connected can be read live; one without cannot.
    setFromOffline((source?.members ?? 0) <= 0);
    setError(null);
    setSaving(false);
  }, [open, source]);

  const invalid =
    to.trim() === "" ? t("board.consumers.rocketmq.clone.targetRequired") : null;

  const save = async () => {
    if (invalid != null) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(to, topic === ALL_TOPICS ? "" : topic, fromOffline);
      onClose();
    } catch (failure) {
      setError(formatErrorMessage(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t("board.consumers.rocketmq.clone.title")}</DialogTitle>
        </DialogHeader>

        <FieldGroup className="gap-3">
          <Field>
            <FieldLabel>
              {t("board.consumers.rocketmq.clone.from")}{" "}
              <span className="mono3 font-normal text-(--c-fg-2)">{from || "—"}</span>
            </FieldLabel>
          </Field>

          <Field>
            <FieldLabel>{t("board.consumers.rocketmq.clone.to")}</FieldLabel>
            <SelectField
              size="default"
              className="w-full"
              value={to}
              onValueChange={setTo}
              placeholder={t("board.consumers.rocketmq.clone.pickTarget")}
              options={targets.map((name) => ({ value: name }))}
            />
          </Field>

          <Field>
            <FieldLabel>Topic</FieldLabel>
            <SelectField
              size="default"
              className="w-full"
              value={topic}
              onValueChange={setTopic}
              options={[
                { value: ALL_TOPICS, label: t("board.consumers.rocketmq.clone.allTopics") },
                ...topics.map((name) => ({ value: name })),
              ]}
            />
          </Field>

          <Field>
            <label className="flex items-center gap-1.5 text-sm">
              <Switch checked={fromOffline} onCheckedChange={setFromOffline} />
              {t("board.consumers.rocketmq.clone.fromOffline")}
            </label>
          </Field>
        </FieldGroup>

        <FieldDescription className="text-xs">
          {t("board.consumers.rocketmq.clone.note")}
        </FieldDescription>

        <DialogFooter className="items-center">
          <span className="text-xs text-muted-foreground">
            {t("board.consumers.rocketmq.clone.risky")}
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
            {t("board.consumers.rocketmq.clone.action")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
