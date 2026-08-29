import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Segmented,
  SelectField,
} from "@/components";

/** Label (with optional grey hint) above the control. */
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
    <div
      className="flex min-w-0 flex-col gap-1.5 text-xs"
      style={span ? { gridColumn: "1/3" } : undefined}
    >
      <span className="font-medium">
        {label} {hint != null && <span className="font-normal text-(--c-muted-2)">{hint}</span>}
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

/** Option keys the RocketMQ driver reads back off a stored profile. */
export const OPTION_VERSION = "version";
export const OPTION_ACCESS = "access";

/**
 * What board 6a collects. The fields the canvas does not draw - group, remark,
 * request timeout - ride along so editing a profile round-trips them instead
 * of clearing what another screen set.
 */
export interface RocketMQDraft {
  name: string;
  version: "4.x" | "5.x";
  access: "ns" | "proxy";
  endpoints: string;
  accessKey: string;
  secretKey: string;
  group: string;
  remark: string;
  timeoutSec: number;
  /**
   * Editing a profile that already has ACL credentials. Go never sends a
   * stored secret back, so the fields show that one exists rather than a value,
   * and a blank field means "keep it" - which is why clearing needs its own
   * gesture below.
   */
  credentialsStored: boolean;
  /** Set by the clear control: submits as credentialsMode "clear". */
  clearCredentials: boolean;
}

export function emptyRocketMQDraft(): RocketMQDraft {
  return {
    name: "",
    version: "5.x",
    access: "ns",
    endpoints: "",
    accessKey: "",
    secretKey: "",
    group: "",
    remark: "",
    timeoutSec: 5,
    credentialsStored: false,
    clearCredentials: false,
  };
}

/** Board 6a — RocketMQ. Version and access mode drive which fields exist. */
export function RocketMQForm({
  value,
  onChange,
}: {
  value: RocketMQDraft;
  onChange: (next: RocketMQDraft) => void;
}) {
  const { t } = useTranslation();
  const set = <K extends keyof RocketMQDraft>(key: K, next: RocketMQDraft[K]) =>
    onChange({ ...value, [key]: next });
  // Once cleared, the fields are empty and typing into them is what sets new
  // credentials, so the placeholder and the clear control both go away.
  const stored = value.credentialsStored && !value.clearCredentials;

  return (
    <>
      <div style={GRID}>
        <Fld label={t("page.connections.form.name")}>
          <Input
            value={value.name}
            placeholder="rocketmq-order"
            onChange={(event) => set("name", event.target.value)}
          />
        </Fld>
        <Fld label={t("page.connections.form.rocketmq.version")}>
          <Segmented
            style={{ alignSelf: "flex-start" }}
            value={value.version}
            onChange={(next: "4.x" | "5.x") =>
              // 4.x has no Proxy, so leaving access on it would submit a mode
              // the version cannot have.
              onChange({ ...value, version: next, access: next === "4.x" ? "ns" : value.access })
            }
            options={[
              { value: "4.x", label: "4.x" },
              { value: "5.x", label: "5.x" },
            ]}
          />
        </Fld>
        {value.version === "5.x" && (
          <Fld label={t("page.connections.form.rocketmq.access")} hint={t("page.connections.form.rocketmq.accessHint")}>
            <Segmented
              style={{ alignSelf: "flex-start" }}
              value={value.access}
              onChange={(next: "ns" | "proxy") => set("access", next)}
              options={[
                { value: "ns", label: t("page.connections.form.rocketmq.accessDirect") },
                { value: "proxy", label: "gRPC Proxy" },
              ]}
            />
          </Fld>
        )}
        <Fld span label={t("page.connections.form.rocketmq.nameServer")} hint={t("page.connections.form.rocketmq.nameServerHint")}>
          <Input
            className="mono3"
            style={MONO}
            value={value.endpoints}
            placeholder="10.12.3.44:9876;10.12.3.45:9876"
            onChange={(event) => set("endpoints", event.target.value)}
          />
        </Fld>
        <Fld
          label="AccessKey"
          hint={
            stored ? (
              <button type="button" className="mqs-linkbtn" onClick={() => set("clearCredentials", true)}>
                {t("page.connections.form.clearCredentials")}
              </button>
            ) : (
              t("page.connections.form.rocketmq.accessKeyHint")
            )
          }
        >
          <Input
            value={value.accessKey}
            placeholder={stored ? t("page.connections.form.secretStored") : undefined}
            onChange={(event) => set("accessKey", event.target.value)}
          />
        </Fld>
        <Fld label="SecretKey">
          <Input
            type="password"
            value={value.secretKey}
            placeholder={stored ? t("page.connections.form.secretStored") : undefined}
            onChange={(event) => set("secretKey", event.target.value)}
          />
        </Fld>
      </div>
      <FormNote
        advanced={<Adv>{t("page.connections.form.rocketmq.advanced")}</Adv>}
        note={
          value.access === "proxy"
            ? t("page.connections.form.rocketmq.proxyNote")
            : t("page.connections.form.rocketmq.note")
        }
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
        <Fld span label={t("page.connections.form.name")}>
          <Input defaultValue="prod-kafka-cn" />
        </Fld>
        <Fld span label="Bootstrap Servers">
          <Input
            className="mono3"
            style={MONO}
            defaultValue="kafka-1:9092, kafka-2:9092, kafka-3:9092"
          />
        </Fld>
        <Fld label={t("page.connections.form.kafka.security")}>
          <SelectField value="SASL_SSL" options={[{ value: "SASL_SSL" }]} />
        </Fld>
        <Fld label={t("page.connections.form.kafka.sasl")}>
          <SelectField value="SCRAM-SHA-256" options={[{ value: "SCRAM-SHA-256" }]} />
        </Fld>
        <Fld label={t("page.connections.form.username")}>
          <Input defaultValue="mq-studio" />
        </Fld>
        <Fld label={t("page.connections.form.password")}>
          <Input type="password" defaultValue="password" />
        </Fld>
        <Fld label={t("page.connections.form.kafka.ca")} hint={t("page.connections.form.kafka.caHint")}>
          <Button variant="outline" size="sm" className="self-start font-normal">
            {t("page.connections.form.kafka.chooseFile")}
          </Button>
        </Fld>
        <Fld label={t("page.connections.form.kafka.skipVerify")}>
          <Switch checked={skipVerify} onCheckedChange={setSkipVerify} style={{ marginTop: "3px" }} />
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
        <Fld span label={t("page.connections.form.name")}>
          <Input defaultValue="rabbit-staging" />
        </Fld>
        <Fld span label={t("page.connections.form.rabbitmq.amqp")}>
          <Input className="mono3" style={MONO} defaultValue="amqps://rabbit.stg.example.com:5671" />
        </Fld>
        <Fld label="vhost">
          <Input className="mono3" style={MONO} defaultValue="/order" />
        </Fld>
        <Fld label={t("page.connections.form.rabbitmq.management")} hint={t("page.connections.form.rabbitmq.managementHint")}>
          <Input className="mono3" style={MONO} defaultValue="https://rabbit.stg:15672" />
        </Fld>
        <Fld label={t("page.connections.form.username")}>
          <Input defaultValue="mq-studio" />
        </Fld>
        <Fld label={t("page.connections.form.password")}>
          <Input type="password" defaultValue="password" />
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
          <Input defaultValue="pulsar-eu" />
        </Fld>
        <Fld label={t("page.connections.form.pulsar.service")} hint={t("page.connections.form.pulsar.serviceHint")}>
          <Input className="mono3" style={MONO} defaultValue="pulsar+ssl://pulsar-eu:6651" />
        </Fld>
        <Fld label={t("page.connections.form.pulsar.admin")} hint={t("page.connections.form.pulsar.adminHint")}>
          <Input className="mono3" style={MONO} defaultValue="https://pulsar-eu:8443" />
        </Fld>
        <Fld span label={t("page.connections.form.pulsar.auth")}>
          <Segmented
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
            <Input
              className="mono3"
              style={{ fontSize: "11px", overflow: "hidden", textOverflow: "ellipsis" }}
              defaultValue="eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJtcS1zdHVkaW8ifQ…"
            />
          </Fld>
        )}
        <Fld label={t("page.connections.form.pulsar.tenant")}>
          <Input className="mono3" style={MONO} defaultValue="ecommerce" />
        </Fld>
        <Fld label={t("page.connections.form.pulsar.namespace")}>
          <Input className="mono3" style={MONO} defaultValue="orders" />
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
        <Fld span label={t("page.connections.form.name")}>
          <Input defaultValue="redis-stream-01" />
        </Fld>
        <Fld span label={t("page.connections.form.redis.mode")}>
          <Segmented
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
          <Input className="mono3" style={MONO} defaultValue="rediss://10.2.0.8:6379" />
        </Fld>
        <Fld label={t("page.connections.form.redis.db")} hint={t("page.connections.form.redis.dbHint")}>
          <Input
            className="mono3"
            style={MONO}
            defaultValue="0"
            disabled={mode === "cluster"}
          />
        </Fld>
        <Fld label={t("page.connections.form.username")} hint={t("page.connections.form.redis.usernameHint")}>
          <Input defaultValue="default" />
        </Fld>
        <Fld label={t("page.connections.form.password")}>
          <Input type="password" defaultValue="password" />
        </Fld>
        <Fld span label={t("page.connections.form.redis.streamFilter")} hint={t("page.connections.form.redis.streamFilterHint")}>
          <Input className="mono3" style={MONO} defaultValue="orders:* ; events:*" />
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
          <Input defaultValue="iot-broker" />
        </Fld>
        <Fld label={t("page.connections.form.mqtt.broker")} hint={t("page.connections.form.mqtt.brokerHint")}>
          <Input className="mono3" style={MONO} defaultValue="mqtts://iot.example.com:8883" />
        </Fld>
        <Fld label={t("page.connections.form.mqtt.version")}>
          <Segmented
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
          <span
            className="mono3 flex items-center rounded-md border bg-background px-2.5 py-1 text-xs whitespace-nowrap text-muted-foreground"
            style={MONO}
          >
            mq-studio-8f21c3
            <RefreshCw size={12} className="ml-auto text-(--c-ok)" aria-hidden />
          </span>
        </Fld>
        <Fld label="Keep Alive">
          <Input className="mono3" style={MONO} defaultValue="60 s" />
        </Fld>
        <Fld label={t("page.connections.form.username")}>
          <Input defaultValue="iot-ops" />
        </Fld>
        <Fld label={t("page.connections.form.password")}>
          <Input type="password" defaultValue="password" />
        </Fld>
        <Fld label="Clean Start">
          <Switch checked={cleanStart} onCheckedChange={setCleanStart} aria-label="Clean Start" style={{ marginTop: "3px" }} />
        </Fld>
        {version === "5.0" && (
          <Fld label={t("page.connections.form.mqtt.sessionExpiry")} hint={t("page.connections.form.mqtt.sessionExpiryHint")}>
            <Input className="mono3" style={MONO} defaultValue="3600 s" />
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
