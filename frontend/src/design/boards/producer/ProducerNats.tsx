import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Page, PageHeader } from "@/design/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Panel, SectionLabel, Status } from "@/components";
import { CodeEditor } from "@/components/code-editor";
import { useConnectionScope } from "@/mq/ConnectionScope";
import * as natsApi from "@/api/nats";
import { formatErrorMessage } from "@/lib/utils";
import {
  emptyProducerDraft,
  producerDraftError,
  toPublishInput,
  type ProducerDraft,
} from "./producerNatsDraft";
import type { PublishResult } from "@bindings/driver/nats/models";

const GRID = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" } as const;

/**
 * The NATS send console.
 *
 * One switch decides which of two quite different things happens, and it is a
 * switch rather than a mode selector because from the sender's side it is one
 * act: put this on this subject. What changes is whether anything is waiting.
 * A core send reaches whoever is listening at that instant and is forgotten,
 * and the server says nothing back - so the result panel says "sent" and not
 * "acknowledged", which is a fact about the protocol rather than a failure.
 * A stored send is captured by whichever stream owns the subject, and comes
 * back with the stream and the sequence it landed at.
 *
 * A subject with a wildcard is refused before it is sent. The server would
 * accept it, match nothing, and report success: the message would reach nobody
 * and be stored by no stream, and this console would say it worked.
 */
export function ProducerNats() {
  const { t } = useTranslation();
  const { id: connID } = useConnectionScope();
  const [draft, setDraft] = useState<ProducerDraft>(emptyProducerDraft);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof ProducerDraft>(key: K, value: ProducerDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const invalid = useMemo(() => producerDraftError(draft), [draft]);
  const requesting = draft.replyTimeoutMs.trim() !== "";

  const send = () => {
    if (invalid != null || sending) return;
    setSending(true);
    setError(null);
    setResult(null);
    void natsApi
      .publish(connID, toPublishInput(draft))
      .then(setResult)
      .catch((sendError: unknown) => setError(formatErrorMessage(sendError)))
      .finally(() => setSending(false));
  };

  return (
    <Page>
      <PageHeader
        title={t("board.producer.nats.title")}
        subtitle={t("board.producer.nats.subtitle")}
      />
      <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "12px" }}>
        <FieldGroup>
          <div style={GRID}>
            <Field>
              <FieldLabel htmlFor="nats-send-subject">
                {t("board.producer.nats.subject")}
              </FieldLabel>
              <Input
                id="nats-send-subject"
                className="mono3"
                value={draft.subject}
                placeholder="orders.created"
                onChange={(event) => set("subject", event.target.value)}
              />
              <FieldDescription>{t("board.producer.nats.subjectHint")}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="nats-send-count">{t("board.producer.nats.count")}</FieldLabel>
              <Input
                id="nats-send-count"
                className="mono3"
                value={draft.count}
                onChange={(event) => set("count", event.target.value)}
              />
              <FieldDescription>{t("board.producer.nats.countHint")}</FieldDescription>
            </Field>
          </div>

          <Field>
            <FieldLabel>{t("board.producer.nats.payload")}</FieldLabel>
            <CodeEditor
              value={draft.payload}
              onValueChange={(value) => set("payload", value)}
              rows={8}
            />
            <FieldDescription>{t("board.producer.nats.payloadHint")}</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="nats-send-headers">
              {t("board.producer.nats.headers")}
            </FieldLabel>
            <CodeEditor
              value={draft.headers}
              onValueChange={(value) => set("headers", value)}
              rows={3}
            />
            <FieldDescription>{t("board.producer.nats.headersHint")}</FieldDescription>
          </Field>

          <Field>
            <span
              style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11.5px" }}
            >
              <Switch
                checked={draft.persist}
                onCheckedChange={(value: boolean) => set("persist", value)}
              />
              <span style={{ color: "var(--c-muted)" }}>
                {t("board.producer.nats.persist")}
              </span>
            </span>
            <FieldDescription>
              {draft.persist
                ? t("board.producer.nats.persistOn")
                : t("board.producer.nats.persistOff")}
            </FieldDescription>
          </Field>

          {draft.persist && (
            <div style={GRID}>
              <Field>
                <FieldLabel htmlFor="nats-send-expect">
                  {t("board.producer.nats.expectStream")}
                </FieldLabel>
                <Input
                  id="nats-send-expect"
                  className="mono3"
                  value={draft.expectStream}
                  onChange={(event) => set("expectStream", event.target.value)}
                />
                <FieldDescription>{t("board.producer.nats.expectStreamHint")}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="nats-send-dedup">
                  {t("board.producer.nats.dedupId")}
                </FieldLabel>
                <Input
                  id="nats-send-dedup"
                  className="mono3"
                  value={draft.deduplicationId}
                  onChange={(event) => set("deduplicationId", event.target.value)}
                />
                <FieldDescription>{t("board.producer.nats.dedupIdHint")}</FieldDescription>
              </Field>
            </div>
          )}

          <Field>
            <FieldLabel htmlFor="nats-send-reply">{t("board.producer.nats.reply")}</FieldLabel>
            <Input
              id="nats-send-reply"
              className="mono3"
              value={draft.replyTimeoutMs}
              placeholder={t("board.producer.nats.replyPlaceholder")}
              onChange={(event) => set("replyTimeoutMs", event.target.value)}
            />
            <FieldDescription>{t("board.producer.nats.replyHint")}</FieldDescription>
          </Field>

          {invalid != null && (
            <FieldDescription style={{ color: "var(--c-err)" }}>
              {t(`board.producer.nats.error.${invalid}`)}
            </FieldDescription>
          )}
        </FieldGroup>

        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <Button disabled={invalid != null || sending} onClick={send}>
            {sending && <Spinner className="size-3.5" />}
            {requesting ? t("board.producer.nats.request") : t("board.producer.nats.send")}
          </Button>
        </div>

        {error != null && (
          <Panel style={{ padding: "10px 12px", fontSize: "11.5px", color: "var(--c-err)" }}>
            {error}
          </Panel>
        )}

        {result != null && <Result result={result} />}
      </div>
    </Page>
  );
}

/**
 * What the server said.
 *
 * The three outcomes are told apart rather than collapsed into a tick. A core
 * send has no acknowledgement to report and says so; a stored send names where
 * it landed; a duplicate is a success that stored nothing, which is the one
 * somebody most needs to read before pressing send again.
 */
function Result({ result }: { result: PublishResult }) {
  const { t } = useTranslation();
  return (
    <Panel style={{ padding: "10px 12px" }}>
      <SectionLabel style={{ marginBottom: "6px" }}>
        {t("board.producer.nats.result")}
      </SectionLabel>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
        <Status tone="ok" style={{ fontSize: "10px" }}>
          {t("board.producer.nats.sentCount", { count: result.sent })}
        </Status>
        {result.duplicate && (
          <Status tone="warn" style={{ fontSize: "10px" }}>
            {t("board.producer.nats.duplicate")}
          </Status>
        )}
        {result.acknowledged ? (
          <Status tone="ok" style={{ fontSize: "10px" }}>
            {t("board.producer.nats.storedAt", {
              stream: result.stream,
              sequence: result.sequence,
            })}
          </Status>
        ) : (
          !result.answered && (
            <Status tone="off" style={{ fontSize: "10px" }}>
              {/* Not a failure: core NATS acknowledges nothing, and a page
                  showing an unticked box would call the protocol broken. */}
              {t("board.producer.nats.noAcknowledgement")}
            </Status>
          )
        )}
      </div>
      {result.answered && (
        <div style={{ marginTop: "8px" }}>
          <SectionLabel style={{ marginBottom: "4px" }}>
            {t("board.producer.nats.replyBody")}
          </SectionLabel>
          <div className="mono3" style={{ fontSize: "11px", whiteSpace: "pre-wrap" }}>
            {result.reply === "" ? (
              <span style={{ color: "var(--c-muted)" }}>
                {/* Somebody answered with nothing, which is a different fact
                    from nobody answering - and the same blank box. */}
                {t("board.producer.nats.emptyReply")}
              </span>
            ) : (
              result.reply
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
