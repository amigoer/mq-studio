import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import {
  Panel,
  PanelHeader,
  SectionLabel,
  SelectField,
  JsonBlock,
  toast,
} from "@/components";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Page, PageBody, PageHeader } from "@/design/shell";
import { BoardState } from "@/design/boards/BoardState";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { useBrokerData } from "@/hooks/useBrokerData";
import { usePulsarNamespaces } from "@/hooks/pulsar/usePulsarNamespaces";
import { usePulsarTopics } from "@/hooks/pulsar/usePulsarTopics";
import * as pulsarApi from "@/api/pulsar";
import { topicURL } from "@/mq/pulsar/destinations";
import {
  emptyPublishForm,
  toInput,
  validate,
  type PulsarPublishForm,
} from "@/mq/pulsar/publish";
import { formatErrorMessage } from "@/lib/utils";

/**
 * Board 17c — the Pulsar send console.
 *
 * Its own board rather than the shared one, because the shared one collects a
 * topic, tags, keys and a delay level - RocketMQ's vocabulary, of which only
 * the body means anything here. Pulsar has no tag at all: what a RocketMQ
 * producer puts in one, a Pulsar producer puts in a property, so this form
 * collects properties and the browse filter reads them back.
 *
 * The two fields that could quietly do the wrong thing are labelled for it.
 * The delay is in seconds and says so, because nothing in the port fixes a
 * unit; the repeat count is capped at what the driver enforces, so the message
 * names the field rather than arriving as a refusal after the button.
 */
export function ProducerPulsar() {
  const { t } = useTranslation();
  const { id: connID } = useConnectionScope();

  const namespaces = usePulsarNamespaces();
  const [namespace, setNamespace] = useState("");
  const scope = namespace || (namespaces.data?.[0]?.name ?? "");
  const topics = usePulsarTopics(scope);

  const options = (topics.data ?? []).map((entry) => ({
    value: topicURL(entry),
    label: entry.ref.name,
  }));

  const [form, setForm] = useState<PulsarPublishForm>(emptyPublishForm);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string[]>([]);

  const topic = form.topic || (options[0]?.value ?? "");
  const set = <K extends keyof PulsarPublishForm>(key: K, value: PulsarPublishForm[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const invalid = validate({ ...form, topic }, t);

  // Who is publishing to this topic right now, which is how an operator tells
  // this console's messages apart from their application's.
  const producers = useBrokerData(
    useCallback(
      (id: number) => {
        if (topic === "") throw new Error("no topic selected");
        return pulsarApi.getPulsarProducers(id, topic);
      },
      [topic],
    ),
    { enabled: topic !== "" },
  );

  const send = async () => {
    if (invalid != null) return;
    setSending(true);
    try {
      const result = await pulsarApi.publishPulsarMessage(connID, toInput({ ...form, topic }));
      const ids = result.messageIds ?? [];
      setSent(ids);
      toast.success(t("board.producer.pulsar.sent", { count: ids.length }));
      await producers.refresh();
    } catch (failure) {
      toast.error(formatErrorMessage(failure));
    } finally {
      setSending(false);
    }
  };

  return (
    <Page>
      <PageHeader title={t("board.producer.pulsar.title")} subtitle={scope} />
      <PageBody>
        <Panel style={{ padding: "13px 16px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <PanelHeader title={t("board.producer.pulsar.compose")} />

          <FieldGroup className="grid grid-cols-2 gap-x-3.5 gap-y-3">
            <Field>
              <FieldLabel>{t("board.producer.pulsar.namespace")}</FieldLabel>
              <SelectField
                className="w-full"
                value={scope}
                options={(namespaces.data ?? []).map((entry) => ({
                  value: entry.name,
                  label: entry.name,
                }))}
                onValueChange={(next) => {
                  setNamespace(next);
                  set("topic", "");
                }}
              />
            </Field>
            <Field>
              <FieldLabel>{t("board.producer.pulsar.topic")}</FieldLabel>
              <SelectField
                className="w-full"
                value={topic}
                options={options}
                onValueChange={(next) => set("topic", next)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="send-key">{t("board.producer.pulsar.key")}</FieldLabel>
              <Input
                id="send-key"
                className="mono3"
                value={form.key}
                onChange={(event) => set("key", event.target.value)}
              />
              <FieldDescription>{t("board.producer.pulsar.keyHint")}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="send-ordering-key">
                {t("board.producer.pulsar.orderingKey")}
              </FieldLabel>
              <Input
                id="send-ordering-key"
                className="mono3"
                value={form.orderingKey}
                onChange={(event) => set("orderingKey", event.target.value)}
              />
              <FieldDescription>{t("board.producer.pulsar.orderingKeyHint")}</FieldDescription>
            </Field>

            <Field className="col-span-2">
              <FieldLabel htmlFor="send-properties">
                {t("board.producer.pulsar.properties")}
              </FieldLabel>
              {/* Pulsar has no tag: this is where one goes, and it is what the
                  browse filter reads back. */}
              <Textarea
                id="send-properties"
                className="mono3"
                rows={3}
                value={form.properties}
                placeholder={"stage=paid\nregion=eu"}
                onChange={(event) => set("properties", event.target.value)}
              />
              <FieldDescription>{t("board.producer.pulsar.propertiesHint")}</FieldDescription>
            </Field>

            <Field className="col-span-2">
              <FieldLabel htmlFor="send-body">{t("board.producer.pulsar.body")}</FieldLabel>
              <Textarea
                id="send-body"
                className="mono3"
                rows={6}
                value={form.body}
                onChange={(event) => set("body", event.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="send-delay">{t("board.producer.pulsar.delay")}</FieldLabel>
              {/* Seconds, said out loud: nothing in the port fixes a unit, so
                  the label is the only thing that does. */}
              <Input
                id="send-delay"
                className="mono3"
                value={form.delaySeconds}
                placeholder="0"
                onChange={(event) => set("delaySeconds", event.target.value)}
              />
              <FieldDescription>{t("board.producer.pulsar.delayHint")}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="send-count">{t("board.producer.pulsar.count")}</FieldLabel>
              <Input
                id="send-count"
                className="mono3"
                value={form.count}
                onChange={(event) => set("count", event.target.value)}
              />
              <FieldDescription>{t("board.producer.pulsar.countHint")}</FieldDescription>
            </Field>
          </FieldGroup>

          <div className="flex items-center justify-end gap-3">
            {invalid != null && (
              <span className="text-xs text-muted-foreground">{invalid}</span>
            )}
            <Button disabled={invalid != null || sending} onClick={() => void send()}>
              {sending ? <Spinner /> : <Send size={14} aria-hidden />}
              {t("board.producer.pulsar.send")}
            </Button>
          </div>
        </Panel>

        {sent.length > 0 && (
          <Panel style={{ padding: "13px 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
            <SectionLabel>{t("board.producer.pulsar.acknowledged")}</SectionLabel>
            {/* Pulsar's own printed form, so each id can be pasted straight
                into the messages page's lookup box. */}
            <JsonBlock>{sent.join("\n")}</JsonBlock>
          </Panel>
        )}

        <Panel style={{ padding: "13px 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
          <PanelHeader title={t("board.producer.pulsar.publishers")} />
          <BoardState
            state={producers}
            empty={
              <p className="text-xs text-muted-foreground">
                {t("board.producer.pulsar.noPublishers")}
              </p>
            }
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("board.producer.pulsar.producer")}</TableHead>
                  <TableHead>{t("board.producer.pulsar.address")}</TableHead>
                  <TableHead>{t("board.producer.pulsar.clientVersion")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(producers.data ?? []).map((producer) => (
                  <TableRow key={producer.clientId}>
                    <TableCell className="mono3">{producer.clientId}</TableCell>
                    <TableCell className="mono3">{producer.address || "—"}</TableCell>
                    <TableCell className="mono3">{producer.version || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </BoardState>
        </Panel>
      </PageBody>
    </Page>
  );
}
