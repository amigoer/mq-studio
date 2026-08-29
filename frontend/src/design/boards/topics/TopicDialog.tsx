import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Btn, Dialog, Field, Menu, MenuItem, Seg, SelectField } from "@/design/ui";
import { useBrokerData } from "@/hooks/useBrokerData";
import * as clusterApi from "@/api/cluster";
import { BrokerRole, brokerId, brokerName, role } from "@/mq/rocketmq/nodes";
import { TopicPerm, readQueue, topicName, writeQueue, perm } from "@/mq/rocketmq/destinations";
import type { Destination } from "@/api/models";
import { formatErrorMessage } from "@/lib/utils";

/** Every master, which is what a topic normally wants to exist on. */
const ALL_MASTERS = "";

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
  const [brokerOpen, setBrokerOpen] = useState(false);
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

  const brokerLabel =
    form.brokerAddr === ALL_MASTERS
      ? t("board.topics.rocketmq.allMasters", { count: masters.length })
      : form.brokerAddr;

  return (
    <Dialog
      open={open}
      title={t(editing != null ? "board.topics.rocketmq.editTitle" : "board.common.newTopic")}
      onClose={onClose}
      footer={
        <>
          <span style={{ flex: 1 }} />
          {(invalid ?? error) != null && (
            <span
              style={{
                fontSize: "11.5px",
                color: error != null ? "var(--c-err)" : "var(--c-muted)",
                maxWidth: "320px",
                textAlign: "right",
              }}
            >
              {error ?? invalid}
            </span>
          )}
          <Btn onClick={onClose}>{t("common.cancel")}</Btn>
          <Btn variant="primary" disabled={invalid != null || saving} onClick={() => void save()}>
            {t("common.save")}
          </Btn>
        </>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
        <div className="fld" style={{ gridColumn: "1/3" }}>
          <span>{t("board.topics.rocketmq.nameLabel")}</span>
          <Field
            className="mono3"
            value={form.topic}
            placeholder="ORDER_CREATE"
            /* The name is the identity: renaming would be creating a second
               topic and leaving the first behind. */
            disabled={editing != null}
            onChange={(event) => set("topic", event.target.value)}
          />
        </div>

        <div className="fld">
          <span>{t("board.topics.rocketmq.readQueueLabel")}</span>
          <Field
            value={String(form.readQueue)}
            onChange={(event) => set("readQueue", queueCount(event.target.value))}
          />
        </div>
        <div className="fld">
          <span>{t("board.topics.rocketmq.writeQueueLabel")}</span>
          <Field
            value={String(form.writeQueue)}
            onChange={(event) => set("writeQueue", queueCount(event.target.value))}
          />
        </div>

        <div className="fld">
          <span>{t("board.topics.rocketmq.perm")}</span>
          <Seg
            style={{ alignSelf: "flex-start" }}
            value={form.perm}
            onChange={(next: string) => set("perm", next)}
            options={PERMS.map((one) => ({ value: one.value as string, label: t(one.label) }))}
          />
        </div>

        <div className="fld">
          <span>
            Broker{" "}
            <span style={{ color: "var(--c-muted-2)" }}>{t("board.topics.rocketmq.brokerHint")}</span>
          </span>
          <span style={{ position: "relative" }}>
            <SelectField
              style={{ width: "100%" }}
              value={brokerLabel}
              onClick={() => setBrokerOpen((one) => !one)}
            />
            <Menu open={brokerOpen} onClose={() => setBrokerOpen(false)}>
              <MenuItem
                onSelect={() => {
                  set("brokerAddr", ALL_MASTERS);
                  setBrokerOpen(false);
                }}
              >
                {t("board.topics.rocketmq.allMasters", { count: masters.length })}
              </MenuItem>
              {masters.map((node) => (
                <MenuItem
                  key={node.address}
                  onSelect={() => {
                    set("brokerAddr", node.address);
                    setBrokerOpen(false);
                  }}
                >
                  {brokerName(node)}
                  {brokerId(node) !== 0 ? `-${brokerId(node)}` : ""} · {node.address}
                </MenuItem>
              ))}
            </Menu>
          </span>
        </div>
      </div>

      <div style={{ fontSize: "11px", color: "var(--c-muted)", lineHeight: 1.6 }}>
        {t("board.topics.rocketmq.queueNote")}
      </div>
    </Dialog>
  );
}
