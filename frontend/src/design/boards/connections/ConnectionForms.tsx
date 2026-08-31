import { useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, RefreshCw } from "lucide-react";
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

/** Layout for a switch and its explanation on one row. */
const SWITCH_ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  marginTop: "3px",
};

/** Option keys the RocketMQ driver reads back off a stored profile. */
export const OPTION_VERSION = "version";
export const OPTION_ACCESS = "access";

/** What Go falls back to when the profile asks for no timeout of its own. */
const DEFAULT_TIMEOUT_SEC = 5;

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
    timeoutSec: DEFAULT_TIMEOUT_SEC,
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
  // Opens on a profile that already sets one of these, so editing never hides
  // a value the connection is actually using.
  const [advancedOpen, setAdvancedOpen] = useState(
    value.timeoutSec !== DEFAULT_TIMEOUT_SEC || value.remark !== "",
  );
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
            block
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
          <Fld span label={t("page.connections.form.rocketmq.access")} hint={t("page.connections.form.rocketmq.accessHint")}>
            <Segmented
              block
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
        advanced={
          <button
            type="button"
            className="mqs-disclosure"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            <ChevronRight size={12} aria-hidden />
            {t("page.connections.form.rocketmq.advanced")}
          </button>
        }
        note={
          value.access === "proxy"
            ? t("page.connections.form.rocketmq.proxyNote")
            : t("page.connections.form.rocketmq.note")
        }
      />
      {advancedOpen && (
        <div style={GRID}>
          <Fld
            label={t("page.connections.form.rocketmq.timeout")}
            hint={t("page.connections.form.rocketmq.timeoutHint")}
          >
            <Input
              type="number"
              min={1}
              max={300}
              // Blank is a real state: Go reads 0 as "use the default".
              value={value.timeoutSec > 0 ? String(value.timeoutSec) : ""}
              onChange={(event) => {
                const seconds = Number.parseInt(event.target.value, 10);
                set("timeoutSec", Number.isNaN(seconds) ? 0 : seconds);
              }}
            />
          </Fld>
          <Fld label={t("page.connections.form.remark")} hint={t("page.connections.form.remarkHint")}>
            <Input value={value.remark} onChange={(event) => set("remark", event.target.value)} />
          </Fld>
          {/* Drawn but dead: the admin library dials with name servers, a
              timeout and ACL, and nothing else, so a namespace, a trace topic
              or TLS has nowhere to go until it grows the options. */}
          <Fld
            label={t("page.connections.form.rocketmq.instanceId")}
            hint={t("page.connections.soon")}
          >
            <Input disabled placeholder="MQ_INST_1234567890_xxxxxxx" />
          </Fld>
          <Fld
            label={t("page.connections.form.rocketmq.traceTopic")}
            hint={t("page.connections.soon")}
          >
            <Input disabled placeholder="RMQ_SYS_TRACE_TOPIC" />
          </Fld>
          <Fld span label="TLS" hint={t("page.connections.soon")}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "3px" }}>
              <Switch disabled />
              <span style={{ color: "var(--c-muted)" }}>
                {t("page.connections.form.rocketmq.tlsNote")}
              </span>
            </div>
          </Fld>
        </div>
      )}
    </>
  );
}

/**
 * Option keys the Kafka driver reads back off a stored profile.
 *
 * They repeat two of RabbitMQ's strings, and are declared separately on
 * purpose: each set is a private contract between one Go driver and this form,
 * so renaming one family's key must not silently rename the other's.
 */
export const OPTION_KAFKA_SCRAM_SHA = "scramSha";
export const OPTION_KAFKA_TLS = "tls";
export const OPTION_KAFKA_TLS_SKIP_VERIFY = "tlsSkipVerify";
export const OPTION_KAFKA_TLS_CA_FILE = "tlsCaFile";

/** How a Kafka connection authenticates. Anonymous is a real option here. */
export type KafkaMechanism = "none" | "sasl-plain" | "sasl-scram";

/** Kafka's two SCRAM mechanisms are separate credentials on the broker. */
export type KafkaScramSha = "256" | "512";

/**
 * What the Kafka form collects.
 *
 * One address list rather than two: Kafka administers itself over the protocol
 * that carries records, so there is no second endpoint to name. The bootstrap
 * list is only a starting point - the cluster answers with the address of
 * every broker, and those are what the client actually talks to.
 */
export interface KafkaDraft {
  name: string;
  /** Bootstrap servers. This is the profile's endpoints field. */
  endpoints: string;
  mechanism: KafkaMechanism;
  scramSha: KafkaScramSha;
  username: string;
  password: string;
  tls: boolean;
  tlsCaFile: string;
  tlsSkipVerify: boolean;
  group: string;
  remark: string;
  timeoutSec: number;
  /** A stored password never comes back, so blank means "keep it". */
  credentialsStored: boolean;
  clearCredentials: boolean;
}

export function emptyKafkaDraft(): KafkaDraft {
  return {
    name: "",
    endpoints: "",
    mechanism: "none",
    scramSha: "512",
    username: "",
    password: "",
    tls: false,
    tlsCaFile: "",
    tlsSkipVerify: false,
    group: "",
    remark: "",
    timeoutSec: DEFAULT_TIMEOUT_SEC,
    credentialsStored: false,
    clearCredentials: false,
  };
}

/** Board 6b — Kafka. The mechanism decides whether the credential rows show. */
export function KafkaForm({
  value,
  onChange,
}: {
  value: KafkaDraft;
  onChange: (next: KafkaDraft) => void;
}) {
  const { t } = useTranslation();
  const set = <K extends keyof KafkaDraft>(key: K, next: KafkaDraft[K]) =>
    onChange({ ...value, [key]: next });
  const [advancedOpen, setAdvancedOpen] = useState(
    value.timeoutSec !== DEFAULT_TIMEOUT_SEC || value.remark !== "" || value.tls,
  );
  const authenticating = value.mechanism !== "none";
  const stored = value.credentialsStored && !value.clearCredentials;

  return (
    <>
      <div style={GRID}>
        <Fld label={t("page.connections.form.name")}>
          <Input
            value={value.name}
            placeholder="kafka-staging"
            onChange={(event) => set("name", event.target.value)}
          />
        </Fld>
        <Fld label={t("page.connections.form.kafka.mechanism")}>
          <SelectField<KafkaMechanism>
            value={value.mechanism}
            options={[
              { value: "none", label: t("page.connections.form.kafka.mechanismNone") },
              { value: "sasl-plain", label: "SASL/PLAIN" },
              { value: "sasl-scram", label: "SASL/SCRAM" },
            ]}
            onValueChange={(next) =>
              // Dropping to anonymous drops the credential with it. Keeping it
              // would put the old password back the day someone re-selects
              // SASL, without them being shown that it was still there.
              onChange({
                ...value,
                mechanism: next,
                username: next === "none" ? "" : value.username,
                password: next === "none" ? "" : value.password,
              })
            }
          />
        </Fld>
        <Fld
          span
          label={t("page.connections.form.kafka.bootstrap")}
          hint={t("page.connections.form.kafka.bootstrapHint")}
        >
          <Input
            className="mono3"
            style={MONO}
            value={value.endpoints}
            placeholder="kafka-1:9092, kafka-2:9092, kafka-3:9092"
            onChange={(event) => set("endpoints", event.target.value)}
          />
        </Fld>
        {authenticating && (
          <>
            <Fld
              label={t("page.connections.form.username")}
              hint={
                stored ? (
                  <button type="button" className="mqs-linkbtn" onClick={() => set("clearCredentials", true)}>
                    {t("page.connections.form.clearCredentials")}
                  </button>
                ) : undefined
              }
            >
              <Input
                value={value.username}
                placeholder={stored ? t("page.connections.form.secretStored") : undefined}
                onChange={(event) => set("username", event.target.value)}
              />
            </Fld>
            <Fld label={t("page.connections.form.password")}>
              <Input
                type="password"
                value={value.password}
                placeholder={stored ? t("page.connections.form.secretStored") : undefined}
                onChange={(event) => set("password", event.target.value)}
              />
            </Fld>
          </>
        )}
        {value.mechanism === "sasl-scram" && (
          <Fld
            span
            label={t("page.connections.form.kafka.scramSha")}
            hint={t("page.connections.form.kafka.scramShaHint")}
          >
            <Segmented<KafkaScramSha>
              options={[
                { value: "256", label: "SCRAM-SHA-256" },
                { value: "512", label: "SCRAM-SHA-512" },
              ]}
              value={value.scramSha}
              onChange={(next) => set("scramSha", next)}
            />
          </Fld>
        )}
      </div>
      <FormNote
        advanced={
          <button
            type="button"
            className="mqs-disclosure"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            <ChevronRight size={12} aria-hidden />
            {t("page.connections.form.kafka.advanced")}
          </button>
        }
        note={t("page.connections.form.kafka.note")}
      />
      {advancedOpen && (
        <div style={GRID}>
          <Fld
            label={t("page.connections.form.rocketmq.timeout")}
            hint={t("page.connections.form.rocketmq.timeoutHint")}
          >
            <Input
              type="number"
              min={1}
              max={300}
              value={value.timeoutSec > 0 ? String(value.timeoutSec) : ""}
              onChange={(event) => {
                const seconds = Number.parseInt(event.target.value, 10);
                set("timeoutSec", Number.isNaN(seconds) ? 0 : seconds);
              }}
            />
          </Fld>
          <Fld label={t("page.connections.form.remark")} hint={t("page.connections.form.remarkHint")}>
            <Input value={value.remark} onChange={(event) => set("remark", event.target.value)} />
          </Fld>
          <Fld span label="TLS" hint={t("page.connections.form.kafka.tlsHint")}>
            <div style={SWITCH_ROW}>
              <Switch
                checked={value.tls}
                onCheckedChange={(next: boolean) =>
                  // The CA file and skip-verify only mean anything with TLS on,
                  // and leaving them set would silently re-apply them.
                  onChange({
                    ...value,
                    tls: next,
                    tlsCaFile: next ? value.tlsCaFile : "",
                    tlsSkipVerify: next && value.tlsSkipVerify,
                  })
                }
              />
              <span style={{ color: "var(--c-muted)" }}>
                {t("page.connections.form.kafka.tls")}
              </span>
            </div>
          </Fld>
          {value.tls && (
            <>
              <Fld
                span
                label={t("page.connections.form.kafka.caFile")}
                hint={t("page.connections.form.kafka.caFileHint")}
              >
                <Input
                  className="mono3"
                  style={MONO}
                  value={value.tlsCaFile}
                  placeholder="/etc/kafka/ca.pem"
                  onChange={(event) => set("tlsCaFile", event.target.value)}
                />
              </Fld>
              <Fld
                span
                label={t("page.connections.form.kafka.skipVerify")}
                hint={t("page.connections.form.kafka.skipVerifyHint")}
              >
                <div style={SWITCH_ROW}>
                  <Switch
                    checked={value.tlsSkipVerify}
                    onCheckedChange={(next: boolean) => set("tlsSkipVerify", next)}
                  />
                  <span style={{ color: "var(--c-muted)" }}>
                    {t("page.connections.form.kafka.skipVerifyNote")}
                  </span>
                </div>
              </Fld>
            </>
          )}
        </div>
      )}
    </>
  );
}

/** Option keys the RabbitMQ driver reads back off a stored profile. */
export const OPTION_VHOST = "vhost";
export const OPTION_AMQP = "amqpEndpoint";
export const OPTION_TLS = "tls";
export const OPTION_TLS_SKIP_VERIFY = "tlsSkipVerify";

/**
 * What the RabbitMQ form collects.
 *
 * Two addresses rather than one, because RabbitMQ is two listeners: the
 * management API answers the admin pages over HTTP, and AMQP carries the
 * messages. They need not be on one host, so both are asked for - but the AMQP
 * one is optional and derived from the management host when blank, which is
 * what most deployments want.
 */
export interface RabbitMQDraft {
  name: string;
  /** The management API address. This is the profile's endpoints field. */
  management: string;
  amqp: string;
  vhost: string;
  username: string;
  password: string;
  tls: boolean;
  tlsSkipVerify: boolean;
  group: string;
  remark: string;
  timeoutSec: number;
  /** A stored password never comes back, so blank means "keep it". */
  credentialsStored: boolean;
  clearCredentials: boolean;
}

export function emptyRabbitMQDraft(): RabbitMQDraft {
  return {
    name: "",
    management: "",
    amqp: "",
    vhost: "/",
    username: "",
    password: "",
    tls: false,
    tlsSkipVerify: false,
    group: "",
    remark: "",
    timeoutSec: DEFAULT_TIMEOUT_SEC,
    credentialsStored: false,
    clearCredentials: false,
  };
}

/** Board 6c — RabbitMQ. The management API is the whole admin plane. */
export function RabbitMQForm({
  value,
  onChange,
}: {
  value: RabbitMQDraft;
  onChange: (next: RabbitMQDraft) => void;
}) {
  const { t } = useTranslation();
  const set = <K extends keyof RabbitMQDraft>(key: K, next: RabbitMQDraft[K]) =>
    onChange({ ...value, [key]: next });
  const [advancedOpen, setAdvancedOpen] = useState(
    value.timeoutSec !== DEFAULT_TIMEOUT_SEC || value.remark !== "" || value.tls,
  );
  const stored = value.credentialsStored && !value.clearCredentials;

  return (
    <>
      <div style={GRID}>
        <Fld label={t("page.connections.form.name")}>
          <Input
            value={value.name}
            placeholder="rabbit-staging"
            onChange={(event) => set("name", event.target.value)}
          />
        </Fld>
        <Fld label={t("page.connections.form.rabbitmq.vhost")}>
          <Input
            className="mono3"
            style={MONO}
            value={value.vhost}
            placeholder="/"
            onChange={(event) => set("vhost", event.target.value)}
          />
        </Fld>
        <Fld
          span
          label={t("page.connections.form.rabbitmq.management")}
          hint={t("page.connections.form.rabbitmq.managementHint")}
        >
          <Input
            className="mono3"
            style={MONO}
            value={value.management}
            placeholder="http://rabbit.example.com:15672"
            onChange={(event) => set("management", event.target.value)}
          />
        </Fld>
        <Fld
          span
          label={t("page.connections.form.rabbitmq.amqp")}
          hint={t("page.connections.form.rabbitmq.amqpHint")}
        >
          <Input
            className="mono3"
            style={MONO}
            value={value.amqp}
            placeholder={value.tls ? "amqps://rabbit.example.com:5671" : "amqp://rabbit.example.com:5672"}
            onChange={(event) => set("amqp", event.target.value)}
          />
        </Fld>
        <Fld
          label={t("page.connections.form.username")}
          hint={
            stored ? (
              <button type="button" className="mqs-linkbtn" onClick={() => set("clearCredentials", true)}>
                {t("page.connections.form.clearCredentials")}
              </button>
            ) : (
              t("page.connections.form.rabbitmq.usernameHint")
            )
          }
        >
          <Input
            value={value.username}
            placeholder={stored ? t("page.connections.form.secretStored") : undefined}
            onChange={(event) => set("username", event.target.value)}
          />
        </Fld>
        <Fld label={t("page.connections.form.password")}>
          <Input
            type="password"
            value={value.password}
            placeholder={stored ? t("page.connections.form.secretStored") : undefined}
            onChange={(event) => set("password", event.target.value)}
          />
        </Fld>
      </div>
      <FormNote
        advanced={
          <button
            type="button"
            className="mqs-disclosure"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            <ChevronRight size={12} aria-hidden />
            {t("page.connections.form.rabbitmq.advanced")}
          </button>
        }
        note={t("page.connections.form.rabbitmq.note")}
      />
      {advancedOpen && (
        <div style={GRID}>
          <Fld
            label={t("page.connections.form.rocketmq.timeout")}
            hint={t("page.connections.form.rocketmq.timeoutHint")}
          >
            <Input
              type="number"
              min={1}
              max={300}
              value={value.timeoutSec > 0 ? String(value.timeoutSec) : ""}
              onChange={(event) => {
                const seconds = Number.parseInt(event.target.value, 10);
                set("timeoutSec", Number.isNaN(seconds) ? 0 : seconds);
              }}
            />
          </Fld>
          <Fld label={t("page.connections.form.remark")} hint={t("page.connections.form.remarkHint")}>
            <Input value={value.remark} onChange={(event) => set("remark", event.target.value)} />
          </Fld>
          <Fld span label="TLS" hint={t("page.connections.form.rabbitmq.tlsHint")}>
            <div style={SWITCH_ROW}>
              <Switch
                checked={value.tls}
                onCheckedChange={(next: boolean) =>
                  // Skipping verification only means anything with TLS on, and
                  // leaving it set while TLS is off would silently re-apply it.
                  onChange({ ...value, tls: next, tlsSkipVerify: next && value.tlsSkipVerify })
                }
              />
              <span style={{ color: "var(--c-muted)" }}>
                {t("page.connections.form.rabbitmq.tls")}
              </span>
            </div>
          </Fld>
          {value.tls && (
            <Fld span label={t("page.connections.form.rabbitmq.tlsSkipVerify")} hint={t("page.connections.form.rabbitmq.tlsSkipVerifyHint")}>
              <div style={SWITCH_ROW}>
                <Switch
                  checked={value.tlsSkipVerify}
                  onCheckedChange={(next: boolean) => set("tlsSkipVerify", next)}
                />
                <span style={{ color: "var(--c-muted)" }}>
                  {t("page.connections.form.rabbitmq.tlsSkipVerifyNote")}
                </span>
              </div>
            </Fld>
          )}
        </div>
      )}
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
