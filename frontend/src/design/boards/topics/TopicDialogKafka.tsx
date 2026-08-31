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
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { SelectField, useToast } from "@/components";
import { createKafkaTopic } from "@/api/kafka";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { formatErrorMessage } from "@/lib/utils";

/** What the create form collects. */
export interface KafkaTopicDraft {
  name: string;
  partitions: string;
  replicationFactor: string;
  cleanupPolicy: string;
  retentionMs: string;
  minInsyncReplicas: string;
  /** Anything else, as `key=value` lines. */
  extraConfigs: string;
}

export function emptyKafkaTopicDraft(): KafkaTopicDraft {
  return {
    name: "",
    partitions: "3",
    replicationFactor: "",
    cleanupPolicy: "",
    retentionMs: "",
    minInsyncReplicas: "",
    extraConfigs: "",
  };
}

/**
 * Why the draft is all strings.
 *
 * Every field here is optional and blank means "let the cluster decide", which
 * a number cannot express: zero partitions and "you pick" are different
 * requests, and a numeric input would collapse them.
 */
export function validateKafkaTopicDraft(draft: KafkaTopicDraft): string | null {
  if (draft.name.trim() === "") return "nameRequired";
  // Kafka's own rule. A name outside this set is refused by the broker with an
  // error the form can prevent.
  if (!/^[a-zA-Z0-9._-]+$/.test(draft.name.trim())) return "nameInvalid";
  if (draft.name.trim() === "." || draft.name.trim() === "..") return "nameInvalid";
  if (draft.name.trim().length > 249) return "nameTooLong";

  for (const [field, value] of [
    ["partitions", draft.partitions],
    ["replicationFactor", draft.replicationFactor],
    ["minInsyncReplicas", draft.minInsyncReplicas],
    ["retentionMs", draft.retentionMs],
  ] as const) {
    if (value.trim() === "") continue;
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) return "notANumber";
    // retention.ms accepts -1 for "keep forever"; the rest are counts.
    if (field === "retentionMs" ? parsed < -1 : parsed < 1) return "notANumber";
  }
  if (parseConfigLines(draft.extraConfigs) == null) return "configLine";
  return null;
}

/**
 * Reads `key=value` lines into a config map, or null if a line is not one.
 *
 * Free text rather than a curated list of settings: a cluster knows settings
 * this build has never heard of, and a form that only offered the ones it
 * recognised would be less capable than kafka-topics.sh.
 */
export function parseConfigLines(text: string): Record<string, string> | null {
  const configs: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const split = line.indexOf("=");
    if (split <= 0) return null;
    const key = line.slice(0, split).trim();
    const value = line.slice(split + 1).trim();
    if (key === "") return null;
    configs[key] = value;
  }
  return configs;
}

/** The draft as the bridge takes it. */
export function toKafkaTopicInput(draft: KafkaTopicDraft) {
  const configs = parseConfigLines(draft.extraConfigs) ?? {};
  // The named fields win over a duplicate typed into the free-text box, so a
  // form cannot send two values for one setting.
  for (const [key, value] of [
    ["cleanup.policy", draft.cleanupPolicy],
    ["retention.ms", draft.retentionMs],
    ["min.insync.replicas", draft.minInsyncReplicas],
  ] as const) {
    if (value.trim() !== "") configs[key] = value.trim();
  }
  return {
    name: draft.name.trim(),
    partitions: Number.parseInt(draft.partitions, 10) || 0,
    replicationFactor: Number.parseInt(draft.replicationFactor, 10) || 0,
    configs,
  };
}

export function TopicDialogKafka({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const { id: connID } = useConnectionScope();
  const toast = useToast();
  const [draft, setDraft] = useState<KafkaTopicDraft>(emptyKafkaTopicDraft);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDraft(emptyKafkaTopicDraft());
  }, [open]);

  const set = <K extends keyof KafkaTopicDraft>(key: K, value: KafkaTopicDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const problem = validateKafkaTopicDraft(draft);

  const save = async () => {
    if (problem != null) return;
    setSaving(true);
    try {
      await createKafkaTopic(connID, toKafkaTopicInput(draft));
      toast.success(t("board.topics.kafka.created", { name: draft.name.trim() }));
      onCreated();
      onClose();
    } catch (failure) {
      toast.error(formatErrorMessage(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3.5 overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t("board.topics.kafka.newTitle")}</DialogTitle>
        </DialogHeader>

        <Field label={t("board.topics.kafka.name")}>
          <Input
            className="mono3"
            value={draft.name}
            placeholder="orders.created"
            onChange={(event) => set("name", event.target.value)}
          />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
          <Field label={t("board.common.partition")} hint={t("board.topics.kafka.partitionsHint")}>
            <Input
              className="mono3"
              value={draft.partitions}
              onChange={(event) => set("partitions", event.target.value)}
            />
          </Field>
          <Field
            label={t("board.topics.kafka.replicas")}
            hint={t("board.topics.kafka.replicasHint")}
          >
            <Input
              className="mono3"
              value={draft.replicationFactor}
              placeholder={t("board.topics.kafka.clusterDefault")}
              onChange={(event) => set("replicationFactor", event.target.value)}
            />
          </Field>
          <Field label={t("board.topics.kafka.cleanup")}>
            <SelectField
              value={draft.cleanupPolicy}
              placeholder={t("board.topics.kafka.clusterDefault")}
              options={[
                { value: "delete", label: "delete" },
                { value: "compact", label: "compact" },
                { value: "compact,delete", label: "compact,delete" },
              ]}
              onValueChange={(next) => set("cleanupPolicy", next)}
            />
          </Field>
          <Field label={t("board.topics.kafka.minIsr")}>
            <Input
              className="mono3"
              value={draft.minInsyncReplicas}
              placeholder={t("board.topics.kafka.clusterDefault")}
              onChange={(event) => set("minInsyncReplicas", event.target.value)}
            />
          </Field>
        </div>
        <Field label="retention.ms" hint={t("board.topics.kafka.retentionHint")}>
          <Input
            className="mono3"
            value={draft.retentionMs}
            placeholder={t("board.topics.kafka.clusterDefault")}
            onChange={(event) => set("retentionMs", event.target.value)}
          />
        </Field>
        <Field
          label={t("board.topics.kafka.extraConfigs")}
          hint={t("board.topics.kafka.extraConfigsHint")}
        >
          <Textarea
            className="mono3"
            rows={4}
            value={draft.extraConfigs}
            placeholder={"segment.bytes=1073741824\nmax.message.bytes=2097152"}
            onChange={(event) => set("extraConfigs", event.target.value)}
          />
        </Field>

        <DialogFooter className="items-center">
          <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>
            {t("board.topics.kafka.partitionsWarning")}
          </span>
          <span className="flex-1" />
          {problem != null && (
            <span className="max-w-72 text-right text-xs text-muted-foreground">
              {t(`board.topics.kafka.invalid.${problem}`)}
            </span>
          )}
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={problem != null || saving} onClick={() => void save()}>
            {saving && <Spinner />}
            {t("board.common.create")}
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
