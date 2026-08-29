import { useState, type ReactNode } from "react";
import { Field, ProtoBadge, SectionLabel, Seg, SelectField, Sw } from "@/design/ui";
import { ProtocolIcon } from "@/design/icons/ProtocolIcon";
import type { ProtocolId } from "@/design/data/protocols";
import { useTranslation } from "react-i18next";

/** One `label ⋯ control` line inside a protocol panel. */
function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        fontSize: "12px",
        gap: "10px",
      }}
    >
      <span style={{ flex: "none" }}>{label}</span>
      {children}
    </div>
  );
}

/** The grey caveat under every protocol panel. */
function Note({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: "10.5px",
        color: "var(--c-muted)",
        borderTop: "1px solid var(--c-rule)",
        paddingTop: "8px",
        lineHeight: 1.6,
      }}
    >
      {children}
    </div>
  );
}

export function PanelHeader({ protocol, badge }: { protocol: ProtocolId; badge?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <SectionLabel action={badge} actionColor="inherit">
      {t("board.producer.protocolSpecific")}{" "}
      <ProtocolIcon protocol={protocol} style={{ verticalAlign: "-3px" }} />
    </SectionLabel>
  );
}

/**
 * Board 3e's right panel — RocketMQ.
 *
 * Delay level moved into the options card beside the repeat count, where the
 * controls that actually reach the send call live. Ordered-by-key sending is
 * gone: it needs a queue selector the send path does not have.
 */
export function RocketMQPanel() {
  const { t } = useTranslation();
  return (
    <>
      <SectionLabel action={<ProtoBadge protocol="rocketmq" label="RMQ" />} actionColor="inherit">
        {t("board.producer.specificRocketMQ")}
      </SectionLabel>
      <Note>
        {t("board.producer.panelNote")}
        <br />
        {t("board.producer.noteKafka")}
        <br />
        RabbitMQ → Exchange / RoutingKey
        <br />
        {t("board.producer.noteMqtt")}
      </Note>
    </>
  );
}

const ACKS = [
  { value: "0", label: "0" },
  { value: "1", label: "1" },
  { value: "all", label: "all" },
] as const;

/** Board 16a — Kafka. */
export function KafkaPanel() {
  const { t } = useTranslation();
  const [acks, setAcks] = useState<(typeof ACKS)[number]["value"]>("all");
  return (
    <>
      <PanelHeader protocol="kafka" />
      <Row label="acks">
        <Seg options={ACKS} value={acks} onChange={setAcks} />
      </Row>
      <Row label={t("board.producer.targetPartition")}>
        <SelectField style={{ width: "110px" }} value={t("board.producer.autoKeyHash")} />
      </Row>
      <Row label={t("board.producer.compression")}>
        <SelectField style={{ width: "110px" }} value="lz4" />
      </Row>
      <Row label={t("board.producer.keySerde")}>
        <SelectField style={{ width: "110px" }} value="String" />
      </Row>
      <Row label={t("board.producer.valueSerde")}>
        <SelectField style={{ width: "110px" }} value="JSON" />
      </Row>
      <Note>{t("board.producer.noteHeaders")}</Note>
    </>
  );
}

/** Board 16b — RabbitMQ. */
export function RabbitMQPanel() {
  const { t } = useTranslation();
  const [persistent, setPersistent] = useState(true);
  const [mandatory, setMandatory] = useState(false);
  return (
    <>
      <PanelHeader protocol="rabbitmq" />
      <Row label="Exchange">
        <SelectField style={{ width: "130px" }} value="ex.order" />
      </Row>
      <Row label="Routing Key">
        <Field className="mono3" style={{ width: "130px", fontSize: "11px" }} defaultValue="order.created" />
      </Row>
      <Row label="persistent">
        <Sw checked={persistent} onCheckedChange={setPersistent} label="persistent" />
      </Row>
      <Row label="mandatory">
        <Sw checked={mandatory} onCheckedChange={setMandatory} label="mandatory" />
      </Row>
      <Row label={t("board.producer.ttl")}>
        <Field className="mono3" style={{ width: "90px", fontSize: "11px" }} defaultValue="30000 ms" />
      </Row>
      <Note>{t("board.producer.noteConfirm")}</Note>
    </>
  );
}

const ROUTING = [
  { value: "rr", label: "board.term.roundrobin" },
  { value: "key", label: "board.common.byKey" },
] as const;

/** Board 16c — Pulsar. */
export function PulsarPanel() {
  const { t } = useTranslation();
  const [routing, setRouting] = useState<(typeof ROUTING)[number]["value"]>("key");
  return (
    <>
      <PanelHeader protocol="pulsar" />
      <Row label="Key">
        <Field className="mono3" style={{ width: "130px", fontSize: "11px" }} defaultValue="ORD-TEST-001" />
      </Row>
      <Row label={t("board.producer.routingMode")}>
        <Seg options={ROUTING.map((o) => ({ ...o, label: t(o.label) }))} value={routing} onChange={setRouting} />
      </Row>
      <Row label={t("board.producer.scheduled")}>
        <SelectField style={{ width: "130px" }} value="deliverAfter 10s" />
      </Row>
      <Row label="Schema">
        <SelectField style={{ width: "110px" }} value="JSON v3" />
      </Row>
      <Note>{t("board.producer.noteProps")}</Note>
    </>
  );
}

/** Board 16d — Redis. The body itself becomes field/value rows. */
export function RedisPanel() {
  const { t } = useTranslation();
  return (
    <>
      <PanelHeader protocol="redis" />
      <Row label="Entry ID">
        <Field className="mono3" style={{ width: "110px", fontSize: "11px" }} defaultValue={t("board.producer.autoId")} />
      </Row>
      <Row label="MAXLEN">
        <Field className="mono3" style={{ width: "110px", fontSize: "11px" }} defaultValue="~ 1000000" />
      </Row>
      <div>
        <SectionLabel style={{ margin: "2px 0 6px" }}>{t("board.producer.fields")}</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <FieldPair name="orderId" value="ORD-TEST-001" />
          <FieldPair name="amount" value="1.00" />
          <div style={{ fontSize: "11px", color: "var(--c-ok)" }}>{t("board.producer.addField")}</div>
        </div>
      </div>
      <Note>{t("board.producer.noteXadd")}</Note>
    </>
  );
}

function FieldPair({ name, value }: { name: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: "6px" }}>
      <Field className="mono3" style={{ flex: "0 0 90px", fontSize: "11px" }} defaultValue={name} />
      <Field className="mono3" style={{ flex: 1, fontSize: "11px" }} defaultValue={value} />
    </div>
  );
}

const QOS = [
  { value: "0", label: "0" },
  { value: "1", label: "1" },
  { value: "2", label: "2" },
] as const;

/** Board 16e — MQTT. */
export function MqttPanel() {
  const { t } = useTranslation();
  const [qos, setQos] = useState<(typeof QOS)[number]["value"]>("1");
  const [retain, setRetain] = useState(false);
  return (
    <>
      <PanelHeader protocol="mqtt" />
      <Row label={t("board.common.topic")}>
        <Field className="mono3" style={{ width: "150px", fontSize: "11px" }} defaultValue="iot/device/cmd/A19F" />
      </Row>
      <Row label="QoS">
        <Seg options={QOS} value={qos} onChange={setQos} />
      </Row>
      <Row label="Retain">
        <Sw checked={retain} onCheckedChange={setRetain} label="Retain" />
      </Row>
      <Row label={t("board.producer.messageExpiry")}>
        <Field className="mono3" style={{ width: "90px", fontSize: "11px" }} defaultValue="3600 s" />
      </Row>
      <Row label={t("board.producer.responseTopic")}>
        <Field className="mono3" style={{ width: "150px", fontSize: "11px" }} defaultValue="iot/device/ack/A19F" />
      </Row>
      <Note>{t("board.producer.noteRetain")}</Note>
    </>
  );
}

export const PROTOCOL_PANELS: Record<ProtocolId, () => JSX.Element> = {
  rocketmq: RocketMQPanel,
  kafka: KafkaPanel,
  rabbitmq: RabbitMQPanel,
  pulsar: PulsarPanel,
  redis: RedisPanel,
  mqtt: MqttPanel,
};
