import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Send } from "lucide-react";
import { Page, PageBody, PageHeader } from "@/design/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  CodeEditor,
  Combobox,
  KV,
  Panel,
  PanelHeader,
  SectionLabel,
  Segmented,
  SelectField,
  Status,
  toast,
} from "@/components";
import { BoardState } from "@/design/boards/BoardState";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { useRabbitQueues } from "@/hooks/rabbitmq/useRabbitQueues";
import { useRabbitRouting } from "@/hooks/rabbitmq/useRabbitRouting";
import { exchangeLabel, exchangeType } from "@/mq/rabbitmq/destinations";
import { formatErrorMessage } from "@/lib/utils";
import * as rabbitApi from "@/api/rabbitmq";
import {
  CONTENT_TYPES,
  emptyPublishForm,
  toPublishInput,
  validatePublish,
  type PublishForm,
  type Target,
} from "@/mq/rabbitmq/publish";
import type { PublishResult } from "@/api/rabbitmq";

/**
 * The RabbitMQ send console.
 *
 * Its own board rather than the shared one, because the shared one collects a
 * topic, tags, keys and a delay level - RocketMQ's vocabulary, of which only
 * the body means anything here. A message goes to an exchange with a routing
 * key, carries a table of headers and a fixed set of AMQP properties, and has
 * no delay at all.
 *
 * Two switches are on by default because both failures are otherwise silent.
 * A transient message disappears when the node restarts, even on a durable
 * queue. And an unroutable publish is dropped by the broker and still
 * confirmed, so without mandatory the console would report success for a
 * message that no longer exists.
 */
export function ProducerRabbitMQ() {
  const { t } = useTranslation();
  const { id: connID, online } = useConnectionScope();
  const queues = useRabbitQueues();
  const routing = useRabbitRouting();
  const [form, setForm] = useState<PublishForm>(emptyPublishForm);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof PublishForm>(key: K, value: PublishForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const vhost = queues.data?.[0]?.ref.namespace ?? "/";
  const queueNames = useMemo(
    () => (queues.data ?? []).map((queue) => queue.ref.name),
    [queues.data],
  );
  const exchanges = useMemo(() => routing.data?.exchanges ?? [], [routing.data]);
  const chosenExchange = exchanges.find((found) => exchangeLabel(found) === form.exchange);

  const invalid = useMemo(() => validatePublish(form, t), [form, t]);

  const send = useCallback(async () => {
    if (invalid != null) return;
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const sent = await rabbitApi.publish(connID, toPublishInput(form, vhost));
      setResult(sent);
      if (sent != null && sent.unroutable > 0) {
        /* Not a success. The broker took the messages and had nothing to give
           them to, which is the failure this console exists to make visible. */
        toast.error(t("board.producer.rabbitmq.unroutable", { count: sent.unroutable }), {
          description: sent.reason,
        });
      } else {
        toast.success(t("board.producer.rabbitmq.sent", { count: sent?.sent ?? 0 }));
      }
    } catch (sendError) {
      setError(formatErrorMessage(sendError));
    } finally {
      setSending(false);
    }
  }, [connID, form, invalid, t, vhost]);

  return (
    <Page>
      <PageHeader
        title={t("board.producer.rabbitmq.title")}
        subtitle={t("board.producer.rabbitmq.subtitle")}
      />
      <PageBody>
        <BoardState state={{ loading: false, error: null, online, refresh: async () => {} }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <Panel style={{ padding: "12px 16px" }}>
              <PanelHeader title={t("board.producer.rabbitmq.destination")} />
              <FieldGroup>
                <Field>
                  <FieldLabel>{t("board.producer.rabbitmq.addressing")}</FieldLabel>
                  <Segmented
                    block
                    value={form.target}
                    onChange={(next: Target) => set("target", next)}
                    options={[
                      { value: "queue", label: t("board.common.queue") },
                      { value: "exchange", label: t("board.common.exchange") },
                    ]}
                  />
                  <FieldDescription>
                    {t(`board.producer.rabbitmq.addressingHint.${form.target}`)}
                  </FieldDescription>
                </Field>

                {form.target === "queue" ? (
                  <Field>
                    <FieldLabel>{t("board.common.queue")}</FieldLabel>
                    <Combobox
                      value={form.queue}
                      onValueChange={(next) => set("queue", next)}
                      options={queueNames}
                      placeholder={t("board.producer.rabbitmq.pickQueue")}
                    />
                  </Field>
                ) : (
                  <>
                    <Field>
                      <FieldLabel>{t("board.common.exchange")}</FieldLabel>
                      <Combobox
                        value={form.exchange}
                        onValueChange={(next) => set("exchange", next)}
                        options={exchanges.map(exchangeLabel)}
                        placeholder={t("board.producer.rabbitmq.pickExchange")}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="pub-rk">
                        {t("board.messages.rabbitmq.routingKey")}
                      </FieldLabel>
                      <Input
                        id="pub-rk"
                        className="mono3"
                        value={form.routingKey}
                        onChange={(event) => set("routingKey", event.target.value)}
                      />
                      {chosenExchange != null && (
                        <FieldDescription>
                          {t(
                            `board.topics.rabbitmq.bindKeyHint.${exchangeType(chosenExchange)}`,
                            "",
                          )}
                        </FieldDescription>
                      )}
                    </Field>
                  </>
                )}

                <Field orientation="horizontal">
                  <FieldLabel htmlFor="pub-persistent">
                    {t("board.producer.rabbitmq.persistent")}
                  </FieldLabel>
                  <Switch
                    id="pub-persistent"
                    checked={form.persistent}
                    onCheckedChange={(next: boolean) => set("persistent", next)}
                  />
                </Field>
                <FieldDescription>
                  {t("board.producer.rabbitmq.persistentHint")}
                </FieldDescription>

                <Field orientation="horizontal">
                  <FieldLabel htmlFor="pub-mandatory">
                    {t("board.producer.rabbitmq.mandatory")}
                  </FieldLabel>
                  <Switch
                    id="pub-mandatory"
                    checked={form.mandatory}
                    onCheckedChange={(next: boolean) => set("mandatory", next)}
                  />
                </Field>
                <FieldDescription>
                  {t("board.producer.rabbitmq.mandatoryHint")}
                </FieldDescription>

                <Field>
                  <FieldLabel htmlFor="pub-count">
                    {t("board.producer.rabbitmq.count")}
                  </FieldLabel>
                  <Input
                    id="pub-count"
                    type="number"
                    min={1}
                    max={1000}
                    value={form.count}
                    onChange={(event) => set("count", event.target.value)}
                  />
                  <FieldDescription>{t("board.producer.rabbitmq.countHint")}</FieldDescription>
                </Field>
              </FieldGroup>
            </Panel>

            <Panel style={{ padding: "12px 16px" }}>
              <PanelHeader title={t("board.producer.rabbitmq.properties")} />
              <FieldGroup>
                <Field>
                  <FieldLabel>{t("board.producer.rabbitmq.contentType")}</FieldLabel>
                  <SelectField
                    value={form.contentType}
                    onValueChange={(next) => set("contentType", next)}
                    options={CONTENT_TYPES.map((value) => ({ value }))}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="pub-headers">
                    {t("board.producer.rabbitmq.headers")}
                  </FieldLabel>
                  <Input
                    id="pub-headers"
                    className="mono3"
                    value={form.headers}
                    placeholder="kind=order"
                    onChange={(event) => set("headers", event.target.value)}
                  />
                  <FieldDescription>
                    {t("board.producer.rabbitmq.headersHint")}
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="pub-corr">correlation-id</FieldLabel>
                  <Input
                    id="pub-corr"
                    className="mono3"
                    value={form.correlationId}
                    onChange={(event) => set("correlationId", event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="pub-reply">reply-to</FieldLabel>
                  <Input
                    id="pub-reply"
                    className="mono3"
                    value={form.replyTo}
                    onChange={(event) => set("replyTo", event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="pub-msgid">message-id</FieldLabel>
                  <Input
                    id="pub-msgid"
                    className="mono3"
                    value={form.messageId}
                    onChange={(event) => set("messageId", event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="pub-expiry">
                    {t("board.producer.rabbitmq.expiration")}
                  </FieldLabel>
                  <Input
                    id="pub-expiry"
                    className="mono3"
                    value={form.expiration}
                    placeholder={t("board.topics.rabbitmq.unlimited")}
                    onChange={(event) => set("expiration", event.target.value)}
                  />
                  <FieldDescription>
                    {t("board.producer.rabbitmq.expirationHint")}
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="pub-priority">
                    {t("board.producer.rabbitmq.priority")}
                  </FieldLabel>
                  <Input
                    id="pub-priority"
                    type="number"
                    min={0}
                    max={255}
                    value={form.priority}
                    onChange={(event) => set("priority", event.target.value)}
                  />
                  <FieldDescription>
                    {t("board.producer.rabbitmq.priorityHint")}
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </Panel>
          </div>

          <Panel style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
            <SectionLabel>{t("board.producer.rabbitmq.body")}</SectionLabel>
            <CodeEditor
              value={form.body}
              onValueChange={(next: string) => set("body", next)}
              language={form.contentType === "application/json" ? "json" : "text"}
              placeholder='{"orderId": "1001"}'
            />
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <Button disabled={invalid != null || sending || !online} onClick={() => void send()}>
                {sending ? <Spinner /> : <Send size={13} aria-hidden />}
                {t("board.producer.rabbitmq.send")}
              </Button>
              {result != null && <Outcome result={result} />}
              {(invalid ?? error) != null && (
                <span
                  className={
                    "text-xs " + (error != null ? "text-(--c-err)" : "text-muted-foreground")
                  }
                >
                  {error ?? invalid}
                </span>
              )}
            </div>
          </Panel>
        </BoardState>
      </PageBody>
    </Page>
  );
}

/**
 * What the broker actually did, as two facts rather than one.
 *
 * A confirm means it took responsibility for the message; routing means
 * something was bound to receive it. Reporting only the first would call a
 * dropped message a success.
 */
function Outcome({ result }: { result: PublishResult }) {
  const { t } = useTranslation();
  if (result.unroutable > 0) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
        <Status tone="err">
          {t("board.producer.rabbitmq.unroutable", { count: result.unroutable })}
        </Status>
        <span style={{ fontSize: "11.5px", color: "var(--c-muted)" }}>{result.reason}</span>
      </span>
    );
  }
  return (
    <KV rows={[[t("board.producer.rabbitmq.confirmed"), String(result.sent)]]} />
  );
}
