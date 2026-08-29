import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, RefreshCw } from "lucide-react";
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
        {label} {hint != null && <span style={{ color: "var(--c-muted-2)" }}>{hint}</span>}
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

/** The 高级 disclosure line and the right-hand caveat under every form. */
function FormNote({ advanced, note }: { advanced: ReactNode; note: ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--c-muted)" }}>
      <span>{advanced}</span>
      <span>{note}</span>
    </div>
  );
}

/** A hint the canvas marked with a ▸: fields the form does not draw. */
function Adv({ children }: { children: ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
      <ChevronRight size={12} aria-hidden />
      {children}
    </span>
  );
}

/** Keys, not text: the tag is a fixed enum the form offers, so it translates. */
const ENV_KEYS = [
  "page.connections.form.envProd",
  "page.connections.form.envTest",
  "page.connections.form.envDev",
];

/** Board 6a — RocketMQ. Version and access mode drive which fields exist. */
export function RocketMQForm() {
  const { t } = useTranslation();
  const [version, setVersion] = useState<"4.x" | "5.x">("5.x");
  const [access, setAccess] = useState<"ns" | "proxy">("ns");
  return (
    <>
      <div style={GRID}>
        <Fld label={t("page.connections.form.name")}>
          <Field defaultValue="rocketmq-order" />
        </Fld>
        <Fld label={t("page.connections.form.env")}>
          <SelectField value={t(ENV_KEYS[0]!)} />
        </Fld>
        <Fld label={t("page.connections.form.rocketmq.version")}>
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
          <Fld label={t("page.connections.form.rocketmq.access")} hint={t("page.connections.form.rocketmq.accessHint")}>
            <Seg
              style={{ alignSelf: "flex-start" }}
              value={access}
              onChange={setAccess}
              options={[
                { value: "ns", label: t("page.connections.form.rocketmq.accessDirect") },
                { value: "proxy", label: "gRPC Proxy" },
              ]}
            />
          </Fld>
        )}
        <Fld span label={t("page.connections.form.rocketmq.nameServer")} hint={t("page.connections.form.rocketmq.nameServerHint")}>
          <Field className="mono3" style={MONO} defaultValue="10.12.3.44:9876;10.12.3.45:9876" />
        </Fld>
        <Fld label="AccessKey" hint={t("page.connections.form.rocketmq.accessKeyHint")}>
          <Field defaultValue="rocketmq2-admin" />
        </Fld>
        <Fld label="SecretKey">
          <Field type="password" defaultValue="password" />
        </Fld>
      </div>
      <FormNote
        advanced={<Adv>{t("page.connections.form.rocketmq.advanced")}</Adv>}
        note={t("page.connections.form.rocketmq.note")}
      />
    </>
  );
}

/** Board 6b — Kafka. The security protocol decides whether SASL/TLS shows. */
export function KafkaForm() {
  const { t } = useTranslation();
  const [skipVerify, setSkipVerify] = useState(false);
  return (
    <>
      <div style={GRID}>
        <Fld label={t("page.connections.form.name")}>
          <Field defaultValue="prod-kafka-cn" />
        </Fld>
        <Fld label={t("page.connections.form.env")}>
          <SelectField value={t(ENV_KEYS[0]!)} />
        </Fld>
        <Fld span label="Bootstrap Servers">
          <Field
            className="mono3"
            style={MONO}
            defaultValue="kafka-1:9092, kafka-2:9092, kafka-3:9092"
          />
        </Fld>
        <Fld label={t("page.connections.form.kafka.security")}>
          <SelectField value="SASL_SSL" />
        </Fld>
        <Fld label={t("page.connections.form.kafka.sasl")}>
          <SelectField value="SCRAM-SHA-256" />
        </Fld>
        <Fld label={t("page.connections.form.username")}>
          <Field defaultValue="mq-studio" />
        </Fld>
        <Fld label={t("page.connections.form.password")}>
          <Field type="password" defaultValue="password" />
        </Fld>
        <Fld label={t("page.connections.form.kafka.ca")} hint={t("page.connections.form.kafka.caHint")}>
          <button type="button" className="in3">
            {t("page.connections.form.kafka.chooseFile")}
          </button>
        </Fld>
        <Fld label={t("page.connections.form.kafka.skipVerify")}>
          <Sw checked={skipVerify} onCheckedChange={setSkipVerify} label={t("page.connections.form.kafka.skipVerify")} style={{ marginTop: "3px" }} />
        </Fld>
      </div>
      <FormNote
        advanced={<Adv>{t("page.connections.form.kafka.advanced")}</Adv>}
        note={t("page.connections.form.kafka.note")}
      />
    </>
  );
}

/** Board 6c — RabbitMQ. Without the management API the metrics pages degrade. */
export function RabbitMQForm() {
  const { t } = useTranslation();
  return (
    <>
      <div style={GRID}>
        <Fld label={t("page.connections.form.name")}>
          <Field defaultValue="rabbit-staging" />
        </Fld>
        <Fld label={t("page.connections.form.env")}>
          <SelectField value={t(ENV_KEYS[1]!)} />
        </Fld>
        <Fld span label={t("page.connections.form.rabbitmq.amqp")}>
          <Field className="mono3" style={MONO} defaultValue="amqps://rabbit.stg.example.com:5671" />
        </Fld>
        <Fld label="vhost">
          <Field className="mono3" style={MONO} defaultValue="/order" />
        </Fld>
        <Fld label={t("page.connections.form.rabbitmq.management")} hint={t("page.connections.form.rabbitmq.managementHint")}>
          <Field className="mono3" style={MONO} defaultValue="https://rabbit.stg:15672" />
        </Fld>
        <Fld label={t("page.connections.form.username")}>
          <Field defaultValue="mq-studio" />
        </Fld>
        <Fld label={t("page.connections.form.password")}>
          <Field type="password" defaultValue="password" />
        </Fld>
      </div>
      <FormNote
        advanced={<Adv>{t("page.connections.form.rabbitmq.advanced")}</Adv>}
        note={t("page.connections.form.rabbitmq.note")}
      />
    </>
  );
}

/** Board 6d — Pulsar. */
export function PulsarForm() {
  const { t } = useTranslation();
  const [auth, setAuth] = useState<"none" | "token" | "oauth2" | "mtls">("token");
  return (
    <>
      <div style={GRID}>
        <Fld label={t("page.connections.form.name")}>
          <Field defaultValue="pulsar-eu" />
        </Fld>
        <Fld label={t("page.connections.form.env")}>
          <SelectField value={t(ENV_KEYS[0]!)} />
        </Fld>
        <Fld label={t("page.connections.form.pulsar.service")} hint={t("page.connections.form.pulsar.serviceHint")}>
          <Field className="mono3" style={MONO} defaultValue="pulsar+ssl://pulsar-eu:6651" />
        </Fld>
        <Fld label={t("page.connections.form.pulsar.admin")} hint={t("page.connections.form.pulsar.adminHint")}>
          <Field className="mono3" style={MONO} defaultValue="https://pulsar-eu:8443" />
        </Fld>
        <Fld span label={t("page.connections.form.pulsar.auth")}>
          <Seg
            style={{ alignSelf: "flex-start" }}
            value={auth}
            onChange={setAuth}
            options={[
              { value: "none", label: t("page.connections.form.pulsar.authNone") },
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
        <Fld label={t("page.connections.form.pulsar.tenant")}>
          <Field className="mono3" style={MONO} defaultValue="ecommerce" />
        </Fld>
        <Fld label={t("page.connections.form.pulsar.namespace")}>
          <Field className="mono3" style={MONO} defaultValue="orders" />
        </Fld>
      </div>
      <FormNote
        advanced={<Adv>{t("page.connections.form.pulsar.advanced")}</Adv>}
        note={t("page.connections.form.pulsar.note")}
      />
    </>
  );
}

/** Board 6e — Redis Stream. The key filter decides the left-hand Stream list. */
export function RedisForm() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"standalone" | "sentinel" | "cluster">("standalone");
  return (
    <>
      <div style={GRID}>
        <Fld label={t("page.connections.form.name")}>
          <Field defaultValue="redis-stream-01" />
        </Fld>
        <Fld label={t("page.connections.form.env")}>
          <SelectField value={t(ENV_KEYS[0]!)} />
        </Fld>
        <Fld span label={t("page.connections.form.redis.mode")}>
          <Seg
            style={{ alignSelf: "flex-start" }}
            value={mode}
            onChange={setMode}
            options={[
              { value: "standalone", label: t("page.connections.form.redis.standalone") },
              { value: "sentinel", label: t("page.connections.form.redis.sentinel") },
              { value: "cluster", label: "Cluster" },
            ]}
          />
        </Fld>
        <Fld label={t("page.connections.form.redis.address")}>
          <Field className="mono3" style={MONO} defaultValue="rediss://10.2.0.8:6379" />
        </Fld>
        <Fld label={t("page.connections.form.redis.db")} hint={t("page.connections.form.redis.dbHint")}>
          <Field
            className="mono3"
            style={MONO}
            defaultValue="0"
            disabled={mode === "cluster"}
          />
        </Fld>
        <Fld label={t("page.connections.form.username")} hint={t("page.connections.form.redis.usernameHint")}>
          <Field defaultValue="default" />
        </Fld>
        <Fld label={t("page.connections.form.password")}>
          <Field type="password" defaultValue="password" />
        </Fld>
        <Fld span label={t("page.connections.form.redis.streamFilter")} hint={t("page.connections.form.redis.streamFilterHint")}>
          <Field className="mono3" style={MONO} defaultValue="orders:* ; events:*" />
        </Fld>
      </div>
      <FormNote
        advanced={<Adv>{t("page.connections.form.redis.advanced")}</Adv>}
        note={t("page.connections.form.redis.note")}
      />
    </>
  );
}

/** Board 6f — MQTT. Clean Start and session expiry are 5.0-only. */
export function MqttForm() {
  const { t } = useTranslation();
  const [version, setVersion] = useState<"3.1.1" | "5.0">("5.0");
  const [cleanStart, setCleanStart] = useState(true);
  return (
    <>
      <div style={GRID}>
        <Fld label={t("page.connections.form.name")}>
          <Field defaultValue="iot-broker" />
        </Fld>
        <Fld label={t("page.connections.form.env")}>
          <SelectField value={t(ENV_KEYS[0]!)} />
        </Fld>
        <Fld label={t("page.connections.form.mqtt.broker")} hint={t("page.connections.form.mqtt.brokerHint")}>
          <Field className="mono3" style={MONO} defaultValue="mqtts://iot.example.com:8883" />
        </Fld>
        <Fld label={t("page.connections.form.mqtt.version")}>
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
            <RefreshCw size={12} style={{ color: "var(--c-ok)", marginLeft: "auto" }} aria-hidden />
          </span>
        </Fld>
        <Fld label="Keep Alive">
          <Field className="mono3" style={MONO} defaultValue="60 s" />
        </Fld>
        <Fld label={t("page.connections.form.username")}>
          <Field defaultValue="iot-ops" />
        </Fld>
        <Fld label={t("page.connections.form.password")}>
          <Field type="password" defaultValue="password" />
        </Fld>
        <Fld label="Clean Start">
          <Sw checked={cleanStart} onCheckedChange={setCleanStart} label="Clean Start" style={{ marginTop: "3px" }} />
        </Fld>
        {version === "5.0" && (
          <Fld label={t("page.connections.form.mqtt.sessionExpiry")} hint={t("page.connections.form.mqtt.sessionExpiryHint")}>
            <Field className="mono3" style={MONO} defaultValue="3600 s" />
          </Fld>
        )}
      </div>
      <FormNote
        advanced={<Adv>{t("page.connections.form.mqtt.advanced")}</Adv>}
        note={<Adv>{t("page.connections.form.mqtt.note")}</Adv>}
      />
    </>
  );
}
