import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Send } from "lucide-react";
import { Page, PageBody, PageHeader } from "@/design/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { KV, Panel, PanelHeader, SectionLabel, SelectField, Status, WarnBanner } from "@/components";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { useMqttProtocolIsFive } from "@/hooks/mqtt/useMqttBroker";
import { publishMqtt, type PublishResult } from "@/api/mqtt";
import { formatErrorMessage } from "@/lib/utils";
import {
  emptyMqttSendDraft,
  toMqttPublishInput,
  validateMqttSendDraft,
  type MqttSendDraft,
} from "./producerMqttDraft";

const MONO = { fontSize: "11.5px" } as const;

const QOS_OPTIONS = [
  { value: "0", label: "QoS 0" },
  { value: "1", label: "QoS 1" },
  { value: "2", label: "QoS 2" },
];

/**
 * Board 7e — the MQTT send console.
 *
 * What it reports back is the part worth getting right. A publish at QoS 0 is
 * acknowledged by nothing, so "sent" there means the message reached a socket
 * and nothing more is knowable; at QoS 1 and 2 the broker answers, and under
 * 5.0 it can answer that it took the message and had nobody to give it to.
 * All three are successes and they are not the same success.
 *
 * The 5.0 property fields are hidden rather than disabled on a 3.1.1
 * connection, because they are not a setting that connection could turn on:
 * the version was chosen when the connection was made and the two are carried
 * by different client libraries.
 */
export function ProducerMqtt() {
  const { t } = useTranslation();
  const { id: connID, online } = useConnectionScope();
  const protocol5 = useMqttProtocolIsFive();

  const [draft, setDraft] = useState<MqttSendDraft>(emptyMqttSendDraft());
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof MqttSendDraft>(key: K, value: MqttSendDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const invalid = validateMqttSendDraft(draft, protocol5);

  const send = () => {
    if (invalid != null || connID === 0) return;
    setSending(true);
    setError(null);
    setResult(null);
    void publishMqtt(connID, toMqttPublishInput(draft, protocol5))
      .then(setResult)
      .catch((cause: unknown) => setError(formatErrorMessage(cause)))
      .finally(() => setSending(false));
  };

  return (
    <Page>
      <PageHeader
        title={t("shell.nav.mqtt.producer")}
        subtitle={protocol5 ? "MQTT 5.0" : "MQTT 3.1.1"}
        actions={
          <Button disabled={invalid != null || sending || !online} onClick={send}>
            <Send size={14} aria-hidden />
            {t("board.producer.mqtt.send")}
          </Button>
        }
      />
      <PageBody>
        {invalid != null && draft.topic.trim() !== "" && (
          <WarnBanner>{t(`board.producer.mqtt.${invalid}`)}</WarnBanner>
        )}
        {error != null && <WarnBanner>{error}</WarnBanner>}

        <Panel>
          <PanelHeader title={t("board.producer.mqtt.message")} />
          <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 120px", gap: "12px" }}>
              <div>
                <SectionLabel>{t("board.producer.mqtt.topic")}</SectionLabel>
                <Input
                  className="mono3"
                  style={MONO}
                  value={draft.topic}
                  placeholder="sensors/room-1/temperature"
                  onChange={(event) => set("topic", event.target.value)}
                />
              </div>
              <div>
                <SectionLabel>QoS</SectionLabel>
                <SelectField
                  value={draft.qos}
                  options={QOS_OPTIONS}
                  onValueChange={(next) => set("qos", next)}
                />
              </div>
              <div>
                <SectionLabel>{t("board.producer.mqtt.count")}</SectionLabel>
                <Input
                  className="mono3"
                  style={MONO}
                  value={draft.count}
                  onChange={(event) => set("count", event.target.value)}
                />
              </div>
            </div>

            <div>
              <SectionLabel>{t("board.producer.mqtt.payload")}</SectionLabel>
              <Textarea
                className="mono3"
                style={{ ...MONO, minHeight: "120px" }}
                value={draft.payload}
                onChange={(event) => set("payload", event.target.value)}
              />
            </div>

            {/*
              Retain is the only way to leave anything behind on an MQTT
              broker, and it is permanent until something overwrites it - so it
              is a switch with its consequence spelled out rather than a
              checkbox in a row of them.
            */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Switch
                checked={draft.retain}
                onCheckedChange={(next: boolean) => set("retain", next)}
              />
              <span style={{ fontSize: "12px" }}>{t("board.producer.mqtt.retain")}</span>
              <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>
                {t("board.producer.mqtt.retainHint")}
              </span>
            </div>
          </div>
        </Panel>

        {protocol5 && (
          <Panel>
            <PanelHeader
              title={t("board.producer.mqtt.properties")}
              action={
                <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>
                  {t("board.producer.mqtt.propertiesHint")}
                </span>
              }
            />
            <div style={{ padding: "12px 14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div>
                <SectionLabel>{t("board.producer.mqtt.contentType")}</SectionLabel>
                <Input
                  className="mono3"
                  style={MONO}
                  value={draft.contentType}
                  placeholder="application/json"
                  onChange={(event) => set("contentType", event.target.value)}
                />
              </div>
              <div>
                <SectionLabel>{t("board.producer.mqtt.responseTopic")}</SectionLabel>
                <Input
                  className="mono3"
                  style={MONO}
                  value={draft.responseTopic}
                  onChange={(event) => set("responseTopic", event.target.value)}
                />
              </div>
              <div>
                <SectionLabel>{t("board.producer.mqtt.correlation")}</SectionLabel>
                <Input
                  className="mono3"
                  style={MONO}
                  value={draft.correlationData}
                  onChange={(event) => set("correlationData", event.target.value)}
                />
              </div>
              <div>
                <SectionLabel>{t("board.producer.mqtt.expiry")}</SectionLabel>
                <Input
                  className="mono3"
                  style={MONO}
                  value={draft.messageExpiry}
                  placeholder="60"
                  onChange={(event) => set("messageExpiry", event.target.value)}
                />
              </div>
              <div style={{ gridColumn: "1/3" }}>
                <SectionLabel>{t("board.producer.mqtt.userProps")}</SectionLabel>
                <Textarea
                  className="mono3"
                  style={{ ...MONO, minHeight: "70px" }}
                  value={draft.userProperties}
                  placeholder="tenant=acme"
                  onChange={(event) => set("userProperties", event.target.value)}
                />
              </div>
            </div>
          </Panel>
        )}

        {result != null && (
          <Panel>
            <PanelHeader
              title={t("board.producer.mqtt.result")}
              action={
                <Status tone={result.noMatchingSubscribers ? "warn" : "ok"}>
                  {result.noMatchingSubscribers
                    ? t("board.producer.mqtt.noSubscribers")
                    : t("board.producer.mqtt.accepted")}
                </Status>
              }
            />
            <div style={{ padding: "12px 14px" }}>
              <KV
                rows={[
                  [t("board.producer.mqtt.sent"), String(result.sent)],
                  [
                    t("board.producer.mqtt.acknowledged"),
                    // At QoS 0 nothing is acknowledged, so "sent" means the
                    // message reached a socket and nothing more is knowable.
                    result.acknowledged
                      ? t("board.producer.mqtt.byTheBroker")
                      : t("board.producer.mqtt.notAtQos0"),
                  ],
                  ...(result.reason !== ""
                    ? [[t("board.producer.mqtt.reason"), result.reason] as const]
                    : []),
                ]}
              />
            </div>
          </Panel>
        )}
      </PageBody>
    </Page>
  );
}
