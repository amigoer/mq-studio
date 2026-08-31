import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Page, PageBody, PageHeader } from "@/design/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Combobox,
  KV,
  Panel,
  SectionLabel,
  SelectField,
  Status,
  WarnBanner,
  useToast,
} from "@/components";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { useKafkaTopics } from "@/hooks/kafka/useKafkaTopics";
import { sendKafkaRecord } from "@/api/kafka";
import { formatErrorMessage } from "@/lib/utils";
import { isInternal } from "@/mq/kafka/destinations";
import {
  emptyKafkaSendDraft,
  toKafkaRecordInput,
  validateKafkaSendDraft,
  type KafkaAcks,
  type KafkaSendDraft,
} from "./producerKafkaDraft";

/**
 * Board 16a — the Kafka send console.
 *
 * Its own board rather than the shared one, which collects a topic, tags, keys
 * and a delay level: three of those four are RocketMQ's and Kafka has none of
 * them. What a Kafka record has instead is on this form - a partition it can
 * be pinned to, a key that decides the partition when it is not, headers, and
 * an acknowledgement level.
 *
 * The acknowledgement level is a choice rather than a default because it
 * changes what "sent" means. With none, the cluster is never asked, so there
 * is nothing to report about where the record landed and the result says so
 * instead of printing the -1 the producer filled in.
 */
export function ProducerKafka() {
  const { t } = useTranslation();
  const { id: connID } = useConnectionScope();
  const toast = useToast();
  const [draft, setDraft] = useState<KafkaSendDraft>(emptyKafkaSendDraft);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{
    sent: number;
    failed: number;
    partition: number;
    offset: number;
    reason: string;
  } | null>(null);

  const topics = useKafkaTopics();
  const choices = useMemo(
    () =>
      (topics.data ?? [])
        .filter((entry) => !isInternal(entry))
        .map((entry) => ({ value: entry.ref.name }))
        .sort((left, right) => left.value.localeCompare(right.value)),
    [topics.data],
  );

  const set = <K extends keyof KafkaSendDraft>(key: K, value: KafkaSendDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const problem = validateKafkaSendDraft(draft);

  const send = async () => {
    if (problem != null) return;
    setSending(true);
    setResult(null);
    try {
      const outcome = await sendKafkaRecord(connID, toKafkaRecordInput(draft));
      setResult(outcome);
      if (outcome.failed > 0) {
        toast.error(t("board.producer.kafka.someFailed", { n: outcome.failed }));
      } else {
        toast.success(t("board.producer.kafka.sent", { n: outcome.sent }));
      }
    } catch (failure) {
      toast.error(formatErrorMessage(failure));
    } finally {
      setSending(false);
    }
  };

  return (
    <Page>
      <PageHeader title={t("board.producer.kafka.title")} subtitle={t("board.producer.kafka.subtitle")} />
      <PageBody>
        <Panel style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <Field label="Topic">
            <Combobox
              value={draft.topic}
              options={choices}
              placeholder={t("board.messages.kafka.pickTopic")}
              onValueChange={(next: string) => set("topic", next)}
            />
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
            <Field
              label={t("board.common.partition")}
              hint={t("board.producer.kafka.partitionHint")}
            >
              <Input
                className="mono3"
                value={draft.partition}
                placeholder={t("board.producer.kafka.byKey")}
                onChange={(event) => set("partition", event.target.value)}
              />
            </Field>
            <Field label="acks" hint={t("board.producer.kafka.acksHint")}>
              <SelectField<KafkaAcks>
                value={draft.acks}
                options={[
                  { value: "all", label: t("board.producer.kafka.acksAll") },
                  { value: "leader", label: t("board.producer.kafka.acksLeader") },
                  { value: "none", label: t("board.producer.kafka.acksNone") },
                ]}
                onValueChange={(next) => set("acks", next)}
              />
            </Field>
          </div>

          <Field label="Key" hint={t("board.producer.kafka.keyHint")}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Switch checked={draft.withKey} onCheckedChange={(next) => set("withKey", next)} />
              <Input
                className="mono3"
                disabled={!draft.withKey}
                value={draft.key}
                placeholder={draft.withKey ? "ORD-1" : t("board.producer.kafka.noKey")}
                onChange={(event) => set("key", event.target.value)}
              />
            </div>
          </Field>

          <Field label="Value">
            <Textarea
              className="mono3"
              rows={6}
              value={draft.value}
              placeholder={'{"orderId":"ORD-1"}'}
              onChange={(event) => set("value", event.target.value)}
            />
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "12px 14px" }}>
            <Field label="Headers" hint={t("board.producer.kafka.headersHint")}>
              <Textarea
                className="mono3"
                rows={3}
                value={draft.headers}
                placeholder={"trace-id=abc\nsource=checkout"}
                onChange={(event) => set("headers", event.target.value)}
              />
            </Field>
            <Field label={t("board.producer.kafka.count")} hint={t("board.producer.kafka.countHint")}>
              <Input
                className="mono3"
                value={draft.count}
                onChange={(event) => set("count", event.target.value)}
              />
            </Field>
          </div>

          {draft.acks === "none" && (
            <WarnBanner>{t("board.producer.kafka.acksNoneWarning")}</WarnBanner>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Button disabled={problem != null || sending} onClick={() => void send()}>
              {sending && <Spinner />}
              {t("board.producer.kafka.send")}
            </Button>
            {problem != null && (
              <span className="text-xs text-muted-foreground">
                {t(`board.producer.kafka.invalid.${problem}`)}
              </span>
            )}
          </div>
        </Panel>

        {result != null && (
          <Panel style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
            <SectionLabel>{t("board.producer.kafka.result")}</SectionLabel>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              {result.failed > 0 ? (
                <Status tone="err">{t("board.producer.kafka.failedN", { n: result.failed })}</Status>
              ) : (
                <Status tone="ok">{t("board.producer.kafka.sentN", { n: result.sent })}</Status>
              )}
            </div>
            {/* Where it landed is the point: an operator can go and read it
                back by these coordinates. With acks=none the cluster was never
                asked, so there is nothing to report and the board says that
                rather than printing a sentinel. */}
            <KV
              rows={[
                [
                  t("board.producer.kafka.landedOn"),
                  result.offset < 0
                    ? t("board.producer.kafka.notAsked")
                    : `partition ${result.partition} · offset ${result.offset}`,
                ],
                ...(result.reason !== "" ? [[t("board.producer.kafka.reason"), result.reason] as const] : []),
              ]}
            />
          </Panel>
        )}
      </PageBody>
    </Page>
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
