import { useEffect, useMemo, useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { Check, RefreshCw, X } from "lucide-react";
import { Btn, Dialog, SectionLabel } from "@/design/ui";
import { ProtocolIcon } from "@/design/icons/ProtocolIcon";
import { PROTOCOL_ORDER, type ProtocolId } from "@/design/data/protocols";
import { cn, formatErrorMessage } from "@/lib/utils";
import type { ConnectionDraft, CredentialsMode } from "@/api/connection";
import type { Connection as ConnectionProfile } from "@/api/models";
import {
  KafkaForm,
  MqttForm,
  PulsarForm,
  RabbitMQForm,
  RedisForm,
  RocketMQForm,
  emptyRocketMQDraft,
  type RocketMQDraft,
} from "./ConnectionForms";
import { toRocketMQDraft, toSubmission } from "./connectionDraft";

/** Version ranges printed under each tile in the 3a protocol picker. */
const TILE: Record<ProtocolId, { name: string; versions: string }> = {
  rocketmq: { name: "RocketMQ", versions: "4.x / 5.x" },
  kafka: { name: "Kafka", versions: "2.8+" },
  rabbitmq: { name: "RabbitMQ", versions: "3.x" },
  pulsar: { name: "Pulsar", versions: "2.x / 3.x" },
  redis: { name: "Redis Stream", versions: "6.0+" },
  mqtt: { name: "MQTT", versions: "3.1 / 5.0" },
};

/**
 * The five forms that are still boards rather than inputs. They are drawn so
 * the picker shows what the canvas drew, but nothing behind them exists yet,
 * so the dialog refuses to save one instead of storing a profile no page can
 * open.
 */
const STATIC_FORMS: Partial<Record<ProtocolId, () => JSX.Element>> = {
  kafka: KafkaForm,
  rabbitmq: RabbitMQForm,
  pulsar: PulsarForm,
  redis: RedisForm,
  mqtt: MqttForm,
};

/** What the probe last reported, drawn in the footer beside the test button. */
type ProbeState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; latency: string }
  | { kind: "failed"; message: string };

/**
 * Board 3a plus the six protocol forms (6a-6f). Picking a protocol swaps the
 * whole field set — that is the only thing the connection dialog varies.
 *
 * RocketMQ is the one that submits. `editing` turns the dialog into the edit
 * form for a stored profile, which the canvas never drew separately because
 * the field set is the same one.
 */
export function NewConnectionDialog({
  open,
  onClose,
  initialProtocol = "rocketmq",
  editing,
  onSubmit,
  onProbe,
}: {
  open: boolean;
  onClose?: () => void;
  initialProtocol?: ProtocolId;
  /** Set to edit a stored profile instead of creating one. */
  editing?: ConnectionProfile;
  /** Resolves when the profile is stored; rejects with what Go reported. */
  onSubmit?: (draft: ConnectionDraft, credentialsMode: CredentialsMode) => Promise<void>;
  onProbe?: (draft: ConnectionDraft, credentialsMode: CredentialsMode) => Promise<number>;
}) {
  const { t } = useTranslation();
  const [protocol, setProtocol] = useState<ProtocolId>(initialProtocol);
  const [draft, setDraft] = useState<RocketMQDraft>(emptyRocketMQDraft);
  const [probe, setProbe] = useState<ProbeState>({ kind: "idle" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reopening the dialog has to start from what it is opening on, not from
  // whatever the last edit left in state.
  useEffect(() => {
    if (!open) return;
    setDraft(editing != null ? toRocketMQDraft(editing) : emptyRocketMQDraft());
    setProtocol(editing != null ? "rocketmq" : initialProtocol);
    setProbe({ kind: "idle" });
    setError(null);
    setSaving(false);
  }, [editing, initialProtocol, open]);

  const StaticForm = STATIC_FORMS[protocol];
  const proxySelected = draft.version === "5.x" && draft.access === "proxy";
  const invalid = useMemo(() => {
    if (StaticForm != null) return t("page.connections.notWired", { protocol: TILE[protocol].name });
    if (draft.name.trim() === "") return t("page.connections.nameRequired");
    if (draft.endpoints.trim() === "") return t("page.connections.endpointsRequired");
    if (proxySelected) return t("page.connections.form.rocketmq.proxyNote");
    return null;
  }, [StaticForm, draft.endpoints, draft.name, protocol, proxySelected, t]);

  const runProbe = async () => {
    if (invalid != null || onProbe == null) return;
    setProbe({ kind: "running" });
    try {
      const submission = toSubmission(draft);
      const elapsed = await onProbe(submission.draft, submission.credentialsMode);
      setProbe({
        kind: "ok",
        latency: elapsed < 1000 ? `${Math.round(elapsed)}ms` : `${(elapsed / 1000).toFixed(1)}s`,
      });
    } catch (probeError) {
      setProbe({ kind: "failed", message: formatErrorMessage(probeError) });
    }
  };

  const save = async () => {
    if (invalid != null || onSubmit == null) return;
    setSaving(true);
    setError(null);
    try {
      const submission = toSubmission(draft);
      await onSubmit(submission.draft, submission.credentialsMode);
      onClose?.();
    } catch (saveError) {
      setError(formatErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      title={t(editing != null ? "page.connections.dialogTitleEdit" : "page.connections.dialogTitle")}
      onClose={onClose}
      footer={
        <>
          <Btn disabled={invalid != null || probe.kind === "running"} onClick={runProbe}>
            {t("page.connections.dialogTest")}
          </Btn>
          <ProbeResult state={probe} />
          <span style={{ flex: 1 }} />
          {/* The blocking reason belongs beside the button it blocks, not in a
              toast that appears after the click that did nothing. */}
          {(invalid ?? error) != null && (
            <span
              style={{
                fontSize: "11.5px",
                color: error != null ? "var(--c-err)" : "var(--c-muted)",
                maxWidth: "320px",
                textAlign: "right",
              }}
            >
              {error ?? invalid}
            </span>
          )}
          <Btn onClick={onClose}>{t("common.cancel")}</Btn>
          <Btn variant="primary" disabled={invalid != null || saving} onClick={save}>
            {t(editing != null ? "page.connections.dialogSaveOnly" : "page.connections.dialogSave")}
          </Btn>
        </>
      }
    >
      <div>
        <SectionLabel style={{ marginBottom: "8px" }}>{t("page.connections.dialogProtocol")}</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: "8px" }}>
          {PROTOCOL_ORDER.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={p === protocol}
              /* The protocol is what a stored profile is; changing it would
                 make the edit a different connection. */
              disabled={editing != null && p !== "rocketmq"}
              className={cn("ptile", p === protocol && "sel")}
              onClick={() => {
                setProtocol(p);
                setProbe({ kind: "idle" });
                setError(null);
              }}
            >
              <ProtocolIcon protocol={p} size={18} className="" />
              {TILE[p].name}
              <span className="pv">{TILE[p].versions}</span>
            </button>
          ))}
        </div>
      </div>
      {StaticForm != null ? <StaticForm /> : <RocketMQForm value={draft} onChange={setDraft} />}
    </Dialog>
  );
}

function ProbeResult({ state }: { state: ProbeState }) {
  const { t } = useTranslation();
  if (state.kind === "idle") return null;

  const style = {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    fontSize: "11.5px",
    maxWidth: "260px",
  } as const;

  if (state.kind === "running") {
    return (
      <span style={{ ...style, color: "var(--c-muted)" }}>
        <RefreshCw size={13} className="mqs-turning" aria-hidden />
        {t("page.connections.testing")}
      </span>
    );
  }
  if (state.kind === "ok") {
    return (
      <span style={{ ...style, color: "var(--c-ok-text)" }}>
        <Check size={13} aria-hidden />
        {t("page.connections.probeOk", { latency: state.latency })}
      </span>
    );
  }
  return (
    <span style={{ ...style, color: "var(--c-err)" }} title={state.message}>
      <X size={13} aria-hidden />
      {t("page.connections.probeFailed")}
    </span>
  );
}
