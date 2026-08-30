import { useCallback, useEffect, useState } from "react";
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
import { useBrokerData } from "@/hooks/useBrokerData";
import * as clusterApi from "@/api/cluster";
import { BrokerRole, brokerId, brokerName, role } from "@/mq/rocketmq/nodes";
import { TopicPerm, readQueue, topicName, writeQueue, perm } from "@/mq/rocketmq/destinations";
import type { Destination } from "@/api/models";
import { formatErrorMessage } from "@/lib/utils";

/** Every master, which is what a topic normally wants to exist on. */
const ALL_MASTERS = "";

/* A Select item cannot carry the empty string, so "all masters" gets a
   sentinel at the widget boundary and stays "" in the form. */
const ALL_MASTERS_OPTION = "__all_masters__";

const PERMS = [
  { value: TopicPerm.ReadWrite, label: "board.topics.rocketmq.permRW" },
  { value: TopicPerm.ReadOnly, label: "board.topics.rocketmq.permR" },
  { value: TopicPerm.WriteOnly, label: "board.topics.rocketmq.permW" },
] as const;

export interface TopicForm {
  topic: string;
  brokerAddr: string;
  readQueue: number;
  writeQueue: number;
  perm: string;
}

function formOf(topic: Destination | undefined): TopicForm {
  if (topic == null) {
    return { topic: "", brokerAddr: ALL_MASTERS, readQueue: 4, writeQueue: 4, perm: TopicPerm.ReadWrite };
  }
  return {
    topic: topicName(topic),
    brokerAddr: ALL_MASTERS,
    readQueue: Math.max(1, readQueue(topic)),
    writeQueue: Math.max(1, writeQueue(topic)),
    perm: perm(topic),
  };
}

/**
 * Create or edit a topic.
 *
 * The canvas never drew this - it drew the button that opens it - so the form
 * follows the connection dialog's shape: one card of fields, the blocking
 * reason beside the button it blocks.
 *
 * RocketMQ has no separate update command; the broker upserts whatever
 * configuration it is handed, which is why editing reuses the same form and
 * only the name is locked.
 */
export function TopicDialog({
  open,
  editing,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** Set to edit an existing topic instead of creating one. */
  editing?: Destination;
  onClose: () => void;
  onSubmit: (form: TopicForm) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<TopicForm>(() => formOf(editing));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const brokers = useBrokerData(
    useCallback((id: number) => clusterApi.getBrokers(id), []),
    { enabled: open, refreshMs: null },
  );
  const masters = (brokers.data ?? []).filter((node) => role(node) === BrokerRole.Master);

  useEffect(() => {
    if (!open) return;
    setForm(formOf(editing));
    setError(null);
    setSaving(false);
  }, [editing, open]);

  const set = <K extends keyof TopicForm>(key: K, value: TopicForm[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const queueCount = (raw: string) => Math.max(1, Math.min(1024, Number(raw) || 1));

  const invalid =
    form.topic.trim() === ""
      ? t("board.topics.rocketmq.nameRequired")
      : /[\s%]/.test(form.topic)
        ? t("board.topics.rocketmq.nameInvalid")
        : null;

  const save = async () => {
    if (invalid != null) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ ...form, topic: form.topic.trim() });
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
      <DialogContent className="sm:max-w-[580px]">
        <DialogHeader>
          <DialogTitle>
            {t(editing != null ? "board.topics.rocketmq.editTitle" : "board.common.newTopic")}
          </DialogTitle>
        </DialogHeader>

        <FieldGroup className="grid grid-cols-2 gap-x-3.5 gap-y-3">
          <Field className="col-span-2">
            <FieldLabel htmlFor="topic-name">{t("board.topics.rocketmq.nameLabel")}</FieldLabel>
            <Input
              id="topic-name"
              className="mono3"
              value={form.topic}
              placeholder="ORDER_CREATE"
              /* The name is the identity: renaming would be creating a second
                 topic and leaving the first behind. */
              disabled={editing != null}
              onChange={(event) => set("topic", event.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="topic-read-queues">
              {t("board.topics.rocketmq.readQueueLabel")}
            </FieldLabel>
            <Input
              id="topic-read-queues"
              value={String(form.readQueue)}
              onChange={(event) => set("readQueue", queueCount(event.target.value))}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="topic-write-queues">
              {t("board.topics.rocketmq.writeQueueLabel")}
            </FieldLabel>
            <Input
              id="topic-write-queues"
              value={String(form.writeQueue)}
              onChange={(event) => set("writeQueue", queueCount(event.target.value))}
            />
          </Field>

          <Field>
            <FieldLabel>{t("board.topics.rocketmq.perm")}</FieldLabel>
            <Segmented
              className="self-start"
              value={form.perm}
              onChange={(next: string) => set("perm", next)}
              options={PERMS.map((one) => ({ value: one.value as string, label: t(one.label) }))}
            />
          </Field>

          <Field>
            <FieldLabel>
              Broker{" "}
              <span className="font-normal text-muted-foreground">
                {t("board.topics.rocketmq.brokerHint")}
              </span>
            </FieldLabel>
            <SelectField
              size="default"
              className="w-full"
              value={form.brokerAddr === ALL_MASTERS ? ALL_MASTERS_OPTION : form.brokerAddr}
              onValueChange={(next) =>
                set("brokerAddr", next === ALL_MASTERS_OPTION ? ALL_MASTERS : next)
              }
              options={[
                {
                  value: ALL_MASTERS_OPTION,
                  label: t("board.topics.rocketmq.allMasters", { count: masters.length }),
                },
                ...masters.map((node) => ({
                  value: node.address,
                  label: `${brokerName(node)}${brokerId(node) !== 0 ? `-${brokerId(node)}` : ""} · ${node.address}`,
                })),
              ]}
            />
          </Field>
        </FieldGroup>

        <FieldDescription className="text-xs">
          {t("board.topics.rocketmq.queueNote")}
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
