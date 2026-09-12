import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, LoaderCircle, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  SectionLabel,
} from "@/components";
import { ProtocolIcon } from "@/design/icons/ProtocolIcon";
import {
  PROTOCOL_GROUPS,
  PROTOCOL_ORDER,
  isProtocolReady,
  protocolsIn,
  type ProtocolId,
} from "@/design/data/protocols";
import { cn, formatErrorMessage } from "@/lib/utils";
import type { ConnectionDraft, CredentialsMode } from "@/api/connection";
import type { Connection as ConnectionProfile } from "@/api/models";
import {
  KafkaForm,
  ActiveMQForm,
  MqttForm,
  NatsForm,
  NsqForm,
  PulsarForm,
  RabbitMQForm,
  RedisForm,
  RocketMQForm,
  SqsForm,
  GooglePubSubForm,
  IbmMqForm,
  SolaceForm,
  KinesisForm,
  AzureServiceBusForm,
} from "./ConnectionForms";
import {
  emptyDraft,
  isDraftable,
  probeKey,
  toDraft,
  toSubmission,
  type ProtocolDraft,
} from "./connectionDraft";
import { draftInvalidReason } from "./connectionValidation";

/*
 * The second line under each tile in the protocol picker.
 *
 * It says one thing: which releases this driver targets. Not how it reaches
 * them - IBM MQ's mqweb REST and Solace's SEMP v2 are named in their own
 * forms, where the address that uses them is typed, and repeating them here
 * only made those two tiles twice the length of the rest.
 *
 * Three exceptions, each because the version alone would be a lie: ActiveMQ
 * covers two products, and the four hosted services have no version a reader
 * could act on. Keep it under ~17 characters; the first eight set the shape.
 */
const TILE: Record<ProtocolId, { name: string; versions: string }> = {
  rocketmq: { name: "RocketMQ", versions: "4.x / 5.x" },
  kafka: { name: "Kafka", versions: "3.x / 4.x" },
  rabbitmq: { name: "RabbitMQ", versions: "3.x / 4.x" },
  pulsar: { name: "Pulsar", versions: "2.x / 3.x" },
  redis: { name: "Redis Stream", versions: "6.0+" },
  mqtt: { name: "MQTT", versions: "3.1 / 5.0" },
  nats: { name: "NATS", versions: "2.x" },
  // One tile for two products. Which one is behind the console is the
  // driver's to work out, so asking here would only let a user get it wrong.
  activemq: { name: "ActiveMQ", versions: "Classic · Artemis" },
  nsq: { name: "NSQ", versions: "1.x" },
  // No version to print: SQS is a managed service with one, whichever AWS
  // is running. What varies is the region, and that is a form field.
  sqs: { name: "Amazon SQS", versions: "managed" },
  // Managed for the same reason SQS is, and what varies is the project rather
  // than a region: one address serves every project there is.
  "google-pubsub": { name: "Google Pub/Sub", versions: "managed" },
  // Managed too, and what varies is the namespace - which unlike a region or
  // a project is an address, so it is the one hosted family with an endpoint
  // row rather than a field standing in for one.
  "azure-servicebus": { name: "Azure Service Bus", versions: "managed" },
  // Managed, and back to a region: Kinesis is the second AWS family here and
  // is reached exactly the way SQS is.
  kinesis: { name: "Amazon Kinesis", versions: "managed" },
  // Not managed: this one is a queue manager somebody runs, reached through
  // the web server beside it. The version printed is the mqweb server's REST
  // API rather than the product's, because that is what the driver speaks.
  ibmmq: { name: "IBM MQ", versions: "9.1+" },
  // Not managed either, and the version printed is SEMP's rather than the
  // broker's: v2 is what the driver speaks, and it is the half of the API
  // that has a config and a monitor tree instead of an XML RPC.
  solace: { name: "Solace PubSub+", versions: "9.4+" },
};

/** What the probe last reported, and the settings it was reporting on. */
type ProbeVerdict = { key: string } & (
  | { kind: "ok"; latency: string }
  | { kind: "failed"; message: string }
);

/**
 * The shortest time a test stays on "testing", about one turn of the spinner.
 * A probe answered in 10ms would otherwise flash it for a frame, and a second
 * test that got the same answer would look like no test at all.
 */
const PROBE_MIN_MS = 600;

/**
 * Board 3a with one form per protocol. The canvas drew a field set for every
 * family it imagined; a tile is offered only where a driver and a form both
 * exist, and anything without both is shown disabled rather than offering a
 * form that cannot be saved.
 *
 * `editing` turns the dialog into the edit form for a stored profile, which
 * the canvas never drew separately because the field set is the same one.
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
  const [draft, setDraft] = useState<ProtocolDraft>(() => emptyDraft("rocketmq"));
  const protocol = draft.protocol;
  /*
   * Two steps, not one column.
   *
   * The protocol list and the form it configures are separate questions, and
   * stacking them made the dialog a scroll: fifteen tiles above, the fields
   * that are actually being filled in below, and every vendor added pushing
   * the form further down. Each step now has the whole dialog.
   *
   * An edit opens on the form and cannot go back - the protocol is what a
   * stored profile is, so changing it would make this a different connection.
   */
  const [step, setStep] = useState<"protocol" | "form">(editing == null ? "protocol" : "form");
  const [search, setSearch] = useState("");
  const [verdict, setVerdict] = useState<ProbeVerdict | null>(null);
  const [probing, setProbing] = useState(false);
  // Bumped whenever the form is replaced, so an answer about the old one is dropped.
  const probeRun = useRef(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reopening the dialog has to start from what it is opening on, not from
  // whatever the last edit left in state.
  useEffect(() => {
    if (!open) return;
    if (editing != null) {
      setDraft(toDraft(editing));
    } else {
      const wanted = isProtocolReady(initialProtocol) && isDraftable(initialProtocol)
        ? initialProtocol
        : "rocketmq";
      setDraft(emptyDraft(wanted));
    }
    // Open on a new connection so the whole list is browsable, shut on an
    // edit where the protocol cannot change anyway.
    setStep(editing == null ? "protocol" : "form");
    setSearch("");
    resetProbe();
    setError(null);
    setSaving(false);
  }, [editing, initialProtocol, open]);

  /*
   * Matches a protocol against the search box, by the two things the tile
   * shows: its name and its versions. Typing "managed" finds the hosted
   * three, and "5.0" finds MQTT - both are on the tile, so both are things
   * somebody will try.
   */
  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (candidate: ProtocolId) => {
      if (needle === "") return true;
      const tile = TILE[candidate];
      return (
        tile.name.toLowerCase().includes(needle) ||
        tile.versions.toLowerCase().includes(needle)
      );
    };
  }, [search]);

  const invalid = useMemo(() => draftInvalidReason(draft, t), [draft, t]);

  const draftKey = useMemo(() => probeKey(toSubmission(draft)), [draft]);
  // A verdict on settings the form no longer holds says nothing about these.
  const current = verdict?.key === draftKey ? verdict : null;

  const resetProbe = () => {
    probeRun.current += 1;
    setVerdict(null);
    setProbing(false);
  };

  const runProbe = async () => {
    if (invalid != null || onProbe == null || probing) return;
    const run = ++probeRun.current;
    const key = draftKey;
    const started = performance.now();
    setProbing(true);
    let answer: ProbeVerdict;
    try {
      const submission = toSubmission(draft);
      const elapsed = await onProbe(submission.draft, submission.credentialsMode);
      answer = {
        key,
        kind: "ok",
        latency: elapsed < 1000 ? `${Math.round(elapsed)}ms` : `${(elapsed / 1000).toFixed(1)}s`,
      };
    } catch (probeError) {
      answer = { key, kind: "failed", message: formatErrorMessage(probeError) };
    }
    const hold = PROBE_MIN_MS - (performance.now() - started);
    if (hold > 0) await new Promise((resolve) => setTimeout(resolve, hold));
    if (run !== probeRun.current) return;
    setVerdict(answer);
    setProbing(false);
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
      onOpenChange={(next) => {
        if (!next) onClose?.();
      }}
    >
      <DialogContent className="flex max-h-[85vh] flex-col gap-3.5 overflow-y-auto sm:max-w-[580px]">
        <DialogHeader>
          <DialogTitle>
            {t(
              editing != null
                ? "page.connections.dialogTitleEdit"
                : step === "protocol"
                  ? "page.connections.dialogTitleProtocol"
                  : "page.connections.dialogTitle",
            )}
          </DialogTitle>
        </DialogHeader>
      {step === "protocol" ? (
        <>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("page.connections.protocolSearch")}
            autoFocus
          />
          {PROTOCOL_GROUPS.map((group) => {
            const listed = protocolsIn(group.id).filter(matches);
            if (listed.length === 0) return null;
            return (
              <div key={group.id}>
                <SectionLabel style={{ marginBottom: "8px" }}>{t(group.label)}</SectionLabel>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "8px" }}>
                  {listed.map((p) => {
                    const ready = isProtocolReady(p);
                    return (
                      <button
                        key={p}
                        type="button"
                        disabled={!ready}
                        aria-pressed={p === protocol}
                        /* Highlighted so returning from the form shows which
                           one is in hand, rather than an unmarked grid. */
                        className={cn("ptile", p === protocol && "sel")}
                        onClick={() => {
                          if (!isDraftable(p)) return;
                          setDraft(emptyDraft(p));
                          resetProbe();
                          setError(null);
                          setStep("form");
                        }}
                      >
                        <ProtocolIcon protocol={p} size={20} className="" />
                        {TILE[p].name}
                        <span className="pv">
                          {ready ? TILE[p].versions : t("page.connections.soon")}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {PROTOCOL_ORDER.every((p) => !matches(p)) ? (
            <div style={{ fontSize: "11px", color: "var(--c-muted)" }}>
              {t("page.connections.protocolNoMatch")}
            </div>
          ) : null}
          {/* Only when something really is off. The version that printed
              unconditionally outlived the last dimmed tile and sat there
              describing protocols that all had drivers. */}
          {PROTOCOL_ORDER.some((p) => !isProtocolReady(p)) ? (
            <div style={{ fontSize: "11px", color: "var(--c-muted)" }}>
              {t("page.connections.protocolSoonHint")}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
          </DialogFooter>
        </>
      ) : (
        <>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {editing == null ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setStep("protocol");
              setSearch("");
            }}
          >
            {t("page.connections.protocolBack")}
          </Button>
        ) : null}
        <ProtocolIcon protocol={protocol} size={18} className="" />
        <span style={{ fontWeight: 500 }}>{TILE[protocol].name}</span>
        <span className="pv">{TILE[protocol].versions}</span>
      </div>
      {draft.protocol === "rabbitmq" ? (
        <RabbitMQForm
          value={draft.value}
          onChange={(next) => setDraft({ protocol: "rabbitmq", value: next })}
        />
      ) : draft.protocol === "kafka" ? (
        <KafkaForm
          value={draft.value}
          onChange={(next) => setDraft({ protocol: "kafka", value: next })}
        />
      ) : draft.protocol === "pulsar" ? (
        <PulsarForm
          value={draft.value}
          onChange={(next) => setDraft({ protocol: "pulsar", value: next })}
        />
      ) : draft.protocol === "redis" ? (
        <RedisForm
          value={draft.value}
          onChange={(next) => setDraft({ protocol: "redis", value: next })}
        />
      ) : draft.protocol === "mqtt" ? (
        <MqttForm
          value={draft.value}
          onChange={(next) => setDraft({ protocol: "mqtt", value: next })}
        />
      ) : draft.protocol === "nats" ? (
        <NatsForm
          value={draft.value}
          onChange={(next) => setDraft({ protocol: "nats", value: next })}
        />
      ) : draft.protocol === "activemq" ? (
        <ActiveMQForm
          value={draft.value}
          onChange={(next) => setDraft({ protocol: "activemq", value: next })}
        />
      ) : draft.protocol === "nsq" ? (
        <NsqForm
          value={draft.value}
          onChange={(next) => setDraft({ protocol: "nsq", value: next })}
        />
      ) : draft.protocol === "sqs" ? (
        <SqsForm
          value={draft.value}
          onChange={(next) => setDraft({ protocol: "sqs", value: next })}
        />
      ) : draft.protocol === "google-pubsub" ? (
        <GooglePubSubForm
          value={draft.value}
          onChange={(next) => setDraft({ protocol: "google-pubsub", value: next })}
        />
      ) : draft.protocol === "azure-servicebus" ? (
        <AzureServiceBusForm
          value={draft.value}
          onChange={(next) => setDraft({ protocol: "azure-servicebus", value: next })}
        />
      ) : draft.protocol === "kinesis" ? (
        <KinesisForm
          value={draft.value}
          onChange={(next) => setDraft({ protocol: "kinesis", value: next })}
        />
      ) : draft.protocol === "ibmmq" ? (
        <IbmMqForm
          value={draft.value}
          onChange={(next) => setDraft({ protocol: "ibmmq", value: next })}
        />
      ) : draft.protocol === "solace" ? (
        <SolaceForm
          value={draft.value}
          onChange={(next) => setDraft({ protocol: "solace", value: next })}
        />
      ) : (
        <RocketMQForm
          value={draft.value}
          onChange={(next) => setDraft({ protocol: "rocketmq", value: next })}
        />
      )}

        {/* One box with the footer, so the dialog's gap opens with the reason
            instead of arriving at full size before it. */}
        <div>
          {verdict?.kind === "failed" && (
            <div className="mqs-probe-reveal">
              <div>
                {/* Shown, not hovered: a title attribute is no tooltip on
                    WKWebView, and this is what the test exists to produce.
                    Dimmed rather than dropped once the form moves on, because
                    it is what somebody reads while correcting it. */}
                <Alert
                  className={cn(
                    "mb-3.5 border-transparent bg-(--c-err-bg) px-3 py-2 transition-opacity duration-(--mo-base)",
                    (probing || current == null) && "opacity-50",
                  )}
                >
                  <AlertDescription className="text-xs text-(--c-err-text) [overflow-wrap:anywhere]">
                    {verdict.message}
                  </AlertDescription>
                </Alert>
              </div>
            </div>
          )}
          <DialogFooter className="items-center">
            <Button
              variant="outline"
              disabled={invalid != null}
              aria-busy={probing || undefined}
              className="active:scale-[0.97] aria-busy:cursor-progress"
              onClick={runProbe}
            >
              {t("page.connections.dialogTest")}
            </Button>
            <ProbeStatus probing={probing} verdict={current} />
            <span className="flex-1" />
            {/* The blocking reason belongs beside the button it blocks, not in a
                toast that appears after the click that did nothing. */}
            {(invalid ?? error) != null && (
              <span
                className={
                  "max-w-80 text-right text-xs " +
                  (error != null ? "text-(--c-err)" : "text-muted-foreground")
                }
              >
                {error ?? invalid}
              </span>
            )}
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button disabled={invalid != null || saving} onClick={save}>
              {saving && <Spinner />}
              {t(editing != null ? "page.connections.dialogSaveOnly" : "page.connections.dialogSave")}
            </Button>
          </DialogFooter>
        </div>
        </>
      )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The answer to 测试连接, beside the button that asked for it.
 *
 * The whole exchange happens here rather than in the button: the button keeps
 * its label and width, so nothing next to it shifts when it is pressed, and
 * there is one spinner instead of one in the button and another beside it.
 */
function ProbeStatus({ probing, verdict }: { probing: boolean; verdict: ProbeVerdict | null }) {
  const { t } = useTranslation();
  return (
    <span role="status" className="inline-flex min-w-0 items-center">
      {probing ? (
        <span className="mqs-probe-in inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <LoaderCircle className="mqs-turning size-3.5" aria-hidden />
          {t("page.connections.testing")}
        </span>
      ) : verdict?.kind === "ok" ? (
        <span className="mqs-probe-in inline-flex h-6 items-center gap-1.5 rounded-full bg-(--c-ok-tint) px-2.5 text-xs font-medium text-(--c-ok-text)">
          <Check className="mqs-probe-mark size-3.5" strokeWidth={2.5} aria-hidden />
          {t("page.connections.probeOkShort")}
          <span className="font-normal tabular-nums opacity-70">{verdict.latency}</span>
        </span>
      ) : verdict?.kind === "failed" ? (
        <span className="mqs-probe-in inline-flex h-6 items-center gap-1.5 rounded-full bg-(--c-err-bg) px-2.5 text-xs font-medium text-(--c-err-text)">
          <X className="mqs-probe-mark size-3.5" strokeWidth={2.5} aria-hidden />
          {t("page.connections.probeFailed")}
        </span>
      ) : null}
    </span>
  );
}
