import { useState, type ReactNode } from "react";
import { Field, ProtoBadge, SectionLabel, Seg, SelectField, Sw } from "@/design/ui";
import { ProtocolIcon } from "@/design/icons/ProtocolIcon";
import type { ProtocolId } from "@/design/data/protocols";

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
  return (
    <SectionLabel action={badge} actionColor="inherit">
      协议专属 ·{" "}
      <ProtocolIcon protocol={protocol} style={{ verticalAlign: "-3px" }} />
    </SectionLabel>
  );
}

/** Board 3e's right panel — RocketMQ. */
export function RocketMQPanel() {
  const [ordered, setOrdered] = useState(false);
  return (
    <>
      <SectionLabel action={<ProtoBadge protocol="rocketmq" label="RMQ 5.x" />} actionColor="inherit">
        协议专属 · RocketMQ
      </SectionLabel>
      <Row label="延迟等级">
        <SelectField style={{ width: "120px" }} value="不延迟" />
      </Row>
      <Row label="顺序消息 (按 Key)">
        <Sw checked={ordered} onCheckedChange={setOrdered} label="顺序消息" />
      </Row>
      <Note>
        切换连接后此区自动变化：
        <br />
        Kafka → acks / 指定分区 / 压缩
        <br />
        RabbitMQ → Exchange / RoutingKey
        <br />
        MQTT → QoS / Retain · Pulsar → 定时投递
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
  const [acks, setAcks] = useState<(typeof ACKS)[number]["value"]>("all");
  return (
    <>
      <PanelHeader protocol="kafka" />
      <Row label="acks">
        <Seg options={ACKS} value={acks} onChange={setAcks} />
      </Row>
      <Row label="目标分区">
        <SelectField style={{ width: "110px" }} value="自动（key hash）" />
      </Row>
      <Row label="压缩">
        <SelectField style={{ width: "110px" }} value="lz4" />
      </Row>
      <Row label="Key 序列化">
        <SelectField style={{ width: "110px" }} value="String" />
      </Row>
      <Row label="Value 序列化">
        <SelectField style={{ width: "110px" }} value="JSON" />
      </Row>
      <Note>headers 走通用「自定义属性」区 · key 为空时按分区器路由</Note>
    </>
  );
}

/** Board 16b — RabbitMQ. */
export function RabbitMQPanel() {
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
      <Row label="过期 TTL">
        <Field className="mono3" style={{ width: "90px", fontSize: "11px" }} defaultValue="30000 ms" />
      </Row>
      <Note>confirm 模式返回 ack/nack · mandatory 无法路由时退回</Note>
    </>
  );
}

const ROUTING = [
  { value: "rr", label: "RoundRobin" },
  { value: "key", label: "按 Key" },
] as const;

/** Board 16c — Pulsar. */
export function PulsarPanel() {
  const [routing, setRouting] = useState<(typeof ROUTING)[number]["value"]>("key");
  return (
    <>
      <PanelHeader protocol="pulsar" />
      <Row label="Key">
        <Field className="mono3" style={{ width: "130px", fontSize: "11px" }} defaultValue="ORD-TEST-001" />
      </Row>
      <Row label="路由模式">
        <Seg options={ROUTING} value={routing} onChange={setRouting} />
      </Row>
      <Row label="定时投递">
        <SelectField style={{ width: "130px" }} value="deliverAfter 10s" />
      </Row>
      <Row label="Schema">
        <SelectField style={{ width: "110px" }} value="JSON v3" />
      </Row>
      <Note>properties 走通用属性区 · Schema 校验失败会拒发</Note>
    </>
  );
}

/** Board 16d — Redis. The body itself becomes field/value rows. */
export function RedisPanel() {
  return (
    <>
      <PanelHeader protocol="redis" />
      <Row label="Entry ID">
        <Field className="mono3" style={{ width: "110px", fontSize: "11px" }} defaultValue="*（自动）" />
      </Row>
      <Row label="MAXLEN">
        <Field className="mono3" style={{ width: "110px", fontSize: "11px" }} defaultValue="~ 1000000" />
      </Row>
      <div>
        <SectionLabel style={{ margin: "2px 0 6px" }}>字段 · field / value</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <FieldPair name="orderId" value="ORD-TEST-001" />
          <FieldPair name="amount" value="1.00" />
          <div style={{ fontSize: "11px", color: "var(--c-ok)" }}>+ 添加字段</div>
        </div>
      </div>
      <Note>* = 自动生成 ID · maxlen ~ 为近似裁剪（高性能）</Note>
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
  const [qos, setQos] = useState<(typeof QOS)[number]["value"]>("1");
  const [retain, setRetain] = useState(false);
  return (
    <>
      <PanelHeader protocol="mqtt" />
      <Row label="主题">
        <Field className="mono3" style={{ width: "150px", fontSize: "11px" }} defaultValue="iot/device/cmd/A19F" />
      </Row>
      <Row label="QoS">
        <Seg options={QOS} value={qos} onChange={setQos} />
      </Row>
      <Row label="Retain">
        <Sw checked={retain} onCheckedChange={setRetain} label="Retain" />
      </Row>
      <Row label="消息过期">
        <Field className="mono3" style={{ width: "90px", fontSize: "11px" }} defaultValue="3600 s" />
      </Row>
      <Row label="响应主题">
        <Field className="mono3" style={{ width: "150px", fontSize: "11px" }} defaultValue="iot/device/ack/A19F" />
      </Row>
      <Note>retain 会覆盖该主题的保留消息 · 谨慎用于生产</Note>
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
