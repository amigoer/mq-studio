import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Btn, Dialog, Field, Menu, MenuItem, Seg, SelectField, Sw } from "@/design/ui";
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
  const [topicOpen, setTopicOpen] = useState(false);
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
      title={t("board.common.resetOffset")}
      onClose={onClose}
      footer={
        <>
          <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>
            {t("board.consumers.rocketmq.reset.risky")}
          </span>
          <span style={{ flex: 1 }} />
          {(invalid ?? error) != null && (
            <span
              style={{
                fontSize: "11.5px",
                color: error != null ? "var(--c-err)" : "var(--c-muted)",
                maxWidth: "300px",
                textAlign: "right",
              }}
            >
              {error ?? invalid}
            </span>
          )}
          <Btn onClick={onClose}>{t("common.cancel")}</Btn>
          <Btn variant="primary" disabled={invalid != null || saving} onClick={() => void save()}>
            {t("board.common.resetOffset")}
          </Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div className="fld">
          <span>
            {t("board.common.consumerGroup")}{" "}
            <span className="mono3" style={{ color: "var(--c-fg-2)" }}>
              {group == null ? "—" : groupName(group)}
            </span>
          </span>
        </div>

        <div className="fld">
          <span>Topic</span>
          {topics.length > 0 ? (
            <span style={{ position: "relative" }}>
              <SelectField
                style={{ width: "100%" }}
                value={topic || t("board.messages.rocketmq.pickTopic")}
                onClick={() => setTopicOpen((one) => !one)}
              />
              <Menu open={topicOpen} onClose={() => setTopicOpen(false)}>
                {topics.map((name) => (
                  <MenuItem
                    key={name}
                    onSelect={() => {
                      setTopic(name);
                      setTopicOpen(false);
                    }}
                  >
                    {name}
                  </MenuItem>
                ))}
              </Menu>
            </span>
          ) : (
            /* A group with no client connected reports no subscriptions, so the
               topic has to be typed rather than picked. */
            <Field
              className="mono3"
              value={topic}
              placeholder={t("board.consumers.rocketmq.reset.topicPlaceholder")}
              onChange={(event) => setTopic(event.target.value)}
            />
          )}
        </div>

        <div className="fld">
          <span>{t("board.consumers.rocketmq.reset.target")}</span>
          <Seg
            style={{ alignSelf: "flex-start" }}
            value={target}
            onChange={(next: Target) => setTarget(next)}
            options={TARGETS.map((one) => ({ value: one.value, label: t(one.label) }))}
          />
        </div>

        {target === "at" && (
          <div className="fld">
            <span>{t("board.consumers.rocketmq.reset.at")}</span>
            <Field type="datetime-local" value={at} onChange={(event) => setAt(event.target.value)} />
          </div>
        )}

        <div className="fld">
          <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Sw checked={force} onCheckedChange={setForce} label={t("board.consumers.rocketmq.reset.force")} />
            {t("board.consumers.rocketmq.reset.force")}
          </span>
        </div>

        <div style={{ fontSize: "11px", color: "var(--c-muted)", lineHeight: 1.6 }}>
          {t("board.consumers.rocketmq.reset.note")}
        </div>
      </div>
    </Dialog>
  );
}
