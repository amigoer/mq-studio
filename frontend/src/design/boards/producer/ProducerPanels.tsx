import { useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  ProtoBadge,
  SectionLabel,
  Segmented,
  SelectField,
} from "@/components";
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
        <Segmented options={ACKS} value={acks} onChange={setAcks} />
      </Row>
      <Row label={t("board.producer.targetPartition")}>
        <SelectField className="w-[110px]" value="opt" options={[{ value: "opt", label: t("board.producer.autoKeyHash") }]} />
      </Row>
      <Row label={t("board.producer.compression")}>
        <SelectField className="w-[110px]" value="lz4" options={[{ value: "lz4" }]} />
      </Row>
      <Row label={t("board.producer.keySerde")}>
        <SelectField className="w-[110px]" value="String" options={[{ value: "String" }]} />
      </Row>
      <Row label={t("board.producer.valueSerde")}>
        <SelectField className="w-[110px]" value="JSON" options={[{ value: "JSON" }]} />
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
        <SelectField className="w-[130px]" value="ex.order" options={[{ value: "ex.order" }]} />
      </Row>
      <Row label="Routing Key">
        <Input className="mono3 w-[130px] text-xs" defaultValue="order.created" />
      </Row>
      <Row label="persistent">
        <Switch checked={persistent} onCheckedChange={setPersistent} />
      </Row>
      <Row label="mandatory">
        <Switch checked={mandatory} onCheckedChange={setMandatory} />
      </Row>
      <Row label={t("board.producer.ttl")}>
        <Input className="mono3 w-[90px] text-xs" defaultValue="30000 ms" />
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
        <Input className="mono3 w-[130px] text-xs" defaultValue="ORD-TEST-001" />
      </Row>
      <Row label={t("board.producer.routingMode")}>
        <Segmented options={ROUTING.map((o) => ({ ...o, label: t(o.label) }))} value={routing} onChange={setRouting} />
      </Row>
      <Row label={t("board.producer.scheduled")}>
        <SelectField className="w-[130px]" value="deliverAfter 10s" options={[{ value: "deliverAfter 10s" }]} />
      </Row>
      <Row label="Schema">
        <SelectField className="w-[110px]" value="JSON v3" options={[{ value: "JSON v3" }]} />
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
        <Input className="mono3 w-[110px] text-xs" defaultValue={t("board.producer.autoId")} />
      </Row>
      <Row label="MAXLEN">
        <Input className="mono3 w-[110px] text-xs" defaultValue="~ 1000000" />
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
      <Input className="mono3" style={{ flex: "0 0 90px", fontSize: "11px" }} defaultValue={name} />
      <Input className="mono3" style={{ flex: 1, fontSize: "11px" }} defaultValue={value} />
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
        <Input className="mono3 w-[150px] text-xs" defaultValue="iot/device/cmd/A19F" />
      </Row>
      <Row label="QoS">
        <Segmented options={QOS} value={qos} onChange={setQos} />
      </Row>
      <Row label="Retain">
        <Switch checked={retain} onCheckedChange={setRetain} />
      </Row>
      <Row label={t("board.producer.messageExpiry")}>
        <Input className="mono3 w-[90px] text-xs" defaultValue="3600 s" />
      </Row>
      <Row label={t("board.producer.responseTopic")}>
        <Input className="mono3 w-[150px] text-xs" defaultValue="iot/device/ack/A19F" />
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
