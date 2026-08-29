import { useState, type ReactNode } from "react";
import { Field, Seg, SelectField, Sw } from "@/design/ui";

/** `.fld` — label (with optional grey hint) above the control. */
function Fld({
  label,
  hint,
  span,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  /** Set to make the field span both grid columns. */
  span?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="fld" style={span ? { gridColumn: "1/3" } : undefined}>
      <span>
        {label} {hint != null && <span style={{ color: "#a3a3a3" }}>{hint}</span>}
      </span>
      {children}
    </div>
  );
}

const GRID = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "12px 14px",
} as const;

const MONO = { fontSize: "11.5px" } as const;

/** The `▸ 高级 …` line and the right-hand caveat under every form. */
function FormNote({ advanced, note }: { advanced: string; note: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#8a8a8a" }}>
      <span>{advanced}</span>
      <span>{note}</span>
    </div>
  );
}

const ENVS = ["生产", "测试", "开发"];

/** Board 6a — RocketMQ. Version and access mode drive which fields exist. */
export function RocketMQForm() {
  const [version, setVersion] = useState<"4.x" | "5.x">("5.x");
  const [access, setAccess] = useState<"ns" | "proxy">("ns");
  return (
    <>
      <div style={GRID}>
        <Fld label="连接名称">
          <Field defaultValue="rocketmq-order" />
        </Fld>
        <Fld label="环境标记">
          <SelectField value={ENVS[0]} />
        </Fld>
        <Fld label="版本">
          <Seg
            style={{ alignSelf: "flex-start" }}
            value={version}
            onChange={setVersion}
            options={[
              { value: "4.x", label: "4.x" },
              { value: "5.x", label: "5.x" },
            ]}
          />
        </Fld>
        {version === "5.x" && (
          <Fld label="接入方式" hint="5.x 可选 Proxy">
            <Seg
              style={{ alignSelf: "flex-start" }}
              value={access}
              onChange={setAccess}
              options={[
                { value: "ns", label: "NameServer 直连" },
                { value: "proxy", label: "gRPC Proxy" },
              ]}
            />
          </Fld>
        )}
        <Fld span label="NameServer 地址" hint="分号分隔多个">
          <Field className="mono3" style={MONO} defaultValue="10.12.3.44:9876;10.12.3.45:9876" />
        </Fld>
        <Fld label="AccessKey" hint="ACL 可选">
          <Field defaultValue="rocketmq2-admin" />
        </Fld>
        <Fld label="SecretKey">
          <Field type="password" defaultValue="password" />
        </Fld>
      </div>
      <FormNote
        advanced="▸ 高级：实例 ID（公有云） · 消息轨迹 Topic · 请求超时 · TLS"
        note="切到 4.x 时自动隐藏 Proxy 与 5.x 专属项"
      />
    </>
  );
}

/** Board 6b — Kafka. The security protocol decides whether SASL/TLS shows. */
export function KafkaForm() {
  const [skipVerify, setSkipVerify] = useState(false);
  return (
    <>
      <div style={GRID}>
        <Fld label="连接名称">
          <Field defaultValue="prod-kafka-cn" />
        </Fld>
        <Fld label="环境标记">
          <SelectField value={ENVS[0]} />
        </Fld>
        <Fld span label="Bootstrap Servers">
          <Field
            className="mono3"
            style={MONO}
            defaultValue="kafka-1:9092, kafka-2:9092, kafka-3:9092"
          />
        </Fld>
        <Fld label="安全协议">
          <SelectField value="SASL_SSL" />
        </Fld>
        <Fld label="SASL 机制">
          <SelectField value="SCRAM-SHA-256" />
        </Fld>
        <Fld label="用户名">
          <Field defaultValue="mq-studio" />
        </Fld>
        <Fld label="密码">
          <Field type="password" defaultValue="password" />
        </Fld>
        <Fld label="CA 证书" hint="SSL 时">
          <button type="button" className="in3">
            选择文件… ca.pem
          </button>
        </Fld>
        <Fld label="跳过证书验证">
          <Sw checked={skipVerify} onCheckedChange={setSkipVerify} label="跳过证书验证" style={{ marginTop: "3px" }} />
        </Fld>
      </div>
      <FormNote
        advanced="▸ 高级：client.id · 请求超时 · 客户端证书（mTLS）"
        note="凭证加密存储在本机"
      />
    </>
  );
}

/** Board 6c — RabbitMQ. Without the management API the metrics pages degrade. */
export function RabbitMQForm() {
  return (
    <>
      <div style={GRID}>
        <Fld label="连接名称">
          <Field defaultValue="rabbit-staging" />
        </Fld>
        <Fld label="环境标记">
          <SelectField value={ENVS[1]} />
        </Fld>
        <Fld span label="AMQP 地址">
          <Field className="mono3" style={MONO} defaultValue="amqps://rabbit.stg.example.com:5671" />
        </Fld>
        <Fld label="vhost">
          <Field className="mono3" style={MONO} defaultValue="/order" />
        </Fld>
        <Fld label="管理 API" hint="可选，用于指标">
          <Field className="mono3" style={MONO} defaultValue="https://rabbit.stg:15672" />
        </Fld>
        <Fld label="用户名">
          <Field defaultValue="mq-studio" />
        </Fld>
        <Fld label="密码">
          <Field type="password" defaultValue="password" />
        </Fld>
      </div>
      <FormNote
        advanced="▸ 高级：心跳 60s · 连接超时 · 通道上限 · TLS 证书"
        note="不填管理 API → 仅浏览/收发，无指标页"
      />
    </>
  );
}

/** Board 6d — Pulsar. */
export function PulsarForm() {
  const [auth, setAuth] = useState<"none" | "token" | "oauth2" | "mtls">("token");
  return (
    <>
      <div style={GRID}>
        <Fld label="连接名称">
          <Field defaultValue="pulsar-eu" />
        </Fld>
        <Fld label="环境标记">
          <SelectField value={ENVS[0]} />
        </Fld>
        <Fld label="服务地址" hint="收发">
          <Field className="mono3" style={MONO} defaultValue="pulsar+ssl://pulsar-eu:6651" />
        </Fld>
        <Fld label="管理 API" hint="Topic/租户管理">
          <Field className="mono3" style={MONO} defaultValue="https://pulsar-eu:8443" />
        </Fld>
        <Fld span label="认证方式">
          <Seg
            style={{ alignSelf: "flex-start" }}
            value={auth}
            onChange={setAuth}
            options={[
              { value: "none", label: "无" },
              { value: "token", label: "Token" },
              { value: "oauth2", label: "OAuth2" },
              { value: "mtls", label: "mTLS" },
            ]}
          />
        </Fld>
        {auth === "token" && (
          <Fld span label="Token">
            <Field
              className="mono3"
              style={{ fontSize: "11px", overflow: "hidden", textOverflow: "ellipsis" }}
              defaultValue="eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJtcS1zdHVkaW8ifQ…"
            />
          </Fld>
        )}
        <Fld label="默认租户">
          <Field className="mono3" style={MONO} defaultValue="ecommerce" />
        </Fld>
        <Fld label="默认命名空间">
          <Field className="mono3" style={MONO} defaultValue="orders" />
        </Fld>
      </div>
      <FormNote
        advanced="▸ 高级：操作超时 · TLS CA · 监听器名称"
        note="Topic 页按 租户 / 命名空间 级联浏览"
      />
    </>
  );
}

/** Board 6e — Redis Stream. The key filter decides the left-hand Stream list. */
export function RedisForm() {
  const [mode, setMode] = useState<"standalone" | "sentinel" | "cluster">("standalone");
  return (
    <>
      <div style={GRID}>
        <Fld label="连接名称">
          <Field defaultValue="redis-stream-01" />
        </Fld>
        <Fld label="环境标记">
          <SelectField value={ENVS[0]} />
        </Fld>
        <Fld span label="部署模式">
          <Seg
            style={{ alignSelf: "flex-start" }}
            value={mode}
            onChange={setMode}
            options={[
              { value: "standalone", label: "单机" },
              { value: "sentinel", label: "哨兵" },
              { value: "cluster", label: "Cluster" },
            ]}
          />
        </Fld>
        <Fld label="地址">
          <Field className="mono3" style={MONO} defaultValue="rediss://10.2.0.8:6379" />
        </Fld>
        <Fld label="DB 序号" hint="Cluster 禁用">
          <Field
            className="mono3"
            style={MONO}
            defaultValue="0"
            disabled={mode === "cluster"}
          />
        </Fld>
        <Fld label="用户名" hint="ACL 可选">
          <Field defaultValue="default" />
        </Fld>
        <Fld label="密码">
          <Field type="password" defaultValue="password" />
        </Fld>
        <Fld span label="Stream Key 过滤" hint="决定左侧列表，支持通配">
          <Field className="mono3" style={MONO} defaultValue="orders:* ; events:*" />
        </Fld>
      </div>
      <FormNote
        advanced="▸ 高级：连接超时 · TLS · 只读模式"
        note="只读模式下禁用 XADD / XDEL / XTRIM"
      />
    </>
  );
}

/** Board 6f — MQTT. Clean Start and session expiry are 5.0-only. */
export function MqttForm() {
  const [version, setVersion] = useState<"3.1.1" | "5.0">("5.0");
  const [cleanStart, setCleanStart] = useState(true);
  return (
    <>
      <div style={GRID}>
        <Fld label="连接名称">
          <Field defaultValue="iot-broker" />
        </Fld>
        <Fld label="环境标记">
          <SelectField value={ENVS[0]} />
        </Fld>
        <Fld label="Broker 地址" hint="mqtt/ws">
          <Field className="mono3" style={MONO} defaultValue="mqtts://iot.example.com:8883" />
        </Fld>
        <Fld label="协议版本">
          <Seg
            style={{ alignSelf: "flex-start" }}
            value={version}
            onChange={setVersion}
            options={[
              { value: "3.1.1", label: "3.1.1" },
              { value: "5.0", label: "5.0" },
            ]}
          />
        </Fld>
        <Fld label="Client ID">
          <span className="in3 mono3" style={{ ...MONO, display: "flex" }}>
            mq-studio-8f21c3
            <span style={{ marginLeft: "auto", color: "#29915d" }}>↻</span>
          </span>
        </Fld>
        <Fld label="Keep Alive">
          <Field className="mono3" style={MONO} defaultValue="60 s" />
        </Fld>
        <Fld label="用户名">
          <Field defaultValue="iot-ops" />
        </Fld>
        <Fld label="密码">
          <Field type="password" defaultValue="password" />
        </Fld>
        <Fld label="Clean Start">
          <Sw checked={cleanStart} onCheckedChange={setCleanStart} label="Clean Start" style={{ marginTop: "3px" }} />
        </Fld>
        {version === "5.0" && (
          <Fld label="会话过期" hint="5.0">
            <Field className="mono3" style={MONO} defaultValue="3600 s" />
          </Fld>
        )}
      </div>
      <FormNote
        advanced="▸ 遗嘱消息（LWT）：Topic · Payload · QoS · Retain"
        note="▸ TLS：CA / 客户端证书 · 跳过验证"
      />
    </>
  );
}
