import { useState } from "react";
import { Check, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { Btn, Dialog, SectionLabel } from "@/design/ui";
import { ProtocolIcon } from "@/design/icons/ProtocolIcon";
import { PROTOCOL_ORDER, type ProtocolId } from "@/design/data/protocols";
import { cn } from "@/lib/utils";
import {
  KafkaForm,
  MqttForm,
  PulsarForm,
  RabbitMQForm,
  RedisForm,
  RocketMQForm,
} from "./ConnectionForms";

/** Version ranges printed under each tile in the 3a protocol picker. */
const TILE: Record<ProtocolId, { name: string; versions: string }> = {
  rocketmq: { name: "RocketMQ", versions: "4.x / 5.x" },
  kafka: { name: "Kafka", versions: "2.8+" },
  rabbitmq: { name: "RabbitMQ", versions: "3.x" },
  pulsar: { name: "Pulsar", versions: "2.x / 3.x" },
  redis: { name: "Redis Stream", versions: "6.0+" },
  mqtt: { name: "MQTT", versions: "3.1 / 5.0" },
};

/** The test-connection result line each protocol's board draws in its footer. */
const TEST_RESULT: Record<ProtocolId, { icon: LucideIcon; text: string; color: string }> = {
  rocketmq: { icon: Check, text: "连接成功 · 4 Broker · 5.1.4", color: "var(--c-ok-text)" },
  kafka: { icon: Check, text: "连接成功 · 3 Broker · Controller kafka-1", color: "var(--c-ok-text)" },
  rabbitmq: { icon: TriangleAlert, text: "AMQP 可达 · 管理 API 401（检查账号权限）", color: "var(--c-warn-text)" },
  pulsar: { icon: Check, text: "连接成功 · 3 Broker · 4 Bookie", color: "var(--c-ok-text)" },
  redis: { icon: Check, text: "连接成功 · Redis 7.2 · 扫描到 12 个 Stream", color: "var(--c-ok-text)" },
  mqtt: { icon: X, text: "连接失败 · 证书主机名不匹配（查看详情）", color: "var(--c-err)" },
};

const FORMS: Record<ProtocolId, () => JSX.Element> = {
  rocketmq: RocketMQForm,
  kafka: KafkaForm,
  rabbitmq: RabbitMQForm,
  pulsar: PulsarForm,
  redis: RedisForm,
  mqtt: MqttForm,
};

/**
 * Board 3a plus the six protocol forms (6a-6f). Picking a protocol swaps the
 * whole field set — that is the only thing the connection dialog varies.
 */
export function NewConnectionDialog({
  open,
  onClose,
  initialProtocol = "kafka",
}: {
  open: boolean;
  onClose?: () => void;
  initialProtocol?: ProtocolId;
}) {
  const [protocol, setProtocol] = useState<ProtocolId>(initialProtocol);
  const [tested, setTested] = useState(true);
  const Form = FORMS[protocol];
  const result = TEST_RESULT[protocol];

  return (
    <Dialog
      open={open}
      title="新建连接"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={() => setTested(true)}>测试连接</Btn>
          {tested && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                fontSize: "11.5px",
                color: result.color,
              }}
            >
              <result.icon size={13} aria-hidden />
              {result.text}
            </span>
          )}
          <span style={{ flex: 1 }} />
          <Btn onClick={onClose}>取消</Btn>
          <Btn variant="primary">保存并连接</Btn>
        </>
      }
    >
      <div>
        <SectionLabel style={{ marginBottom: "8px" }}>协议</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: "8px" }}>
          {PROTOCOL_ORDER.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={p === protocol}
              className={cn("ptile", p === protocol && "sel")}
              onClick={() => {
                setProtocol(p);
                setTested(false);
              }}
            >
              <ProtocolIcon protocol={p} size={18} className="" />
              {TILE[p].name}
              <span className="pv">{TILE[p].versions}</span>
            </button>
          ))}
        </div>
      </div>
      <Form />
    </Dialog>
  );
}
