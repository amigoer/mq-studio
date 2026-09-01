import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Play, Search, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DetailPanel,
  DetailPanelBody,
  DetailPanelHeader,
  JsonBlock,
  KV,
  Panel,
  SectionLabel,
  SelectField,
  Status,
  toast,
} from "@/components";
import { ListArea, ListPane, Page, PageHeader, Toolbar } from "@/design/shell";
import { BoardState } from "@/design/boards/BoardState";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { usePulsarNamespaces } from "@/hooks/pulsar/usePulsarNamespaces";
import { usePulsarTopics } from "@/hooks/pulsar/usePulsarTopics";
import { pulsarTail, usePulsarMessages, type PulsarQuery } from "@/hooks/pulsar/usePulsarMessages";
import type { TailCursor } from "@/api/message";
import type { MessageItem } from "@/api/pulsar";
import {
  eventTime,
  orderingKey,
  parsePropertyFilter,
  producerName,
  producerProperties,
  redeliveryCount,
} from "@/mq/pulsar/messages";
import { topicURL } from "@/mq/pulsar/destinations";
import { formatErrorMessage } from "@/lib/utils";

const TAIL_INTERVAL_MS = 2000;
const TAIL_MAX_ROWS = 500;

/**
 * Board 14c — Pulsar messages.
 *
 * Two modes, because Pulsar answers two different questions two different
 * ways. A browse walks the log from the start with a Reader and filters after
 * reading, since there is no message-search endpoint; a tail resumes from a
 * cursor and shows only what arrives next. Both use a Reader, which takes no
 * subscription and moves nobody's position - that is what makes either safe to
 * point at a production topic.
 *
 * There is no tag field. What every other family narrows by does not exist
 * here: a Pulsar producer puts in a property what a RocketMQ one puts in a
 * tag, so the filter is "name=value" against the message's own properties, and
 * a bare name asks which messages carry it at all.
 */
export function MessagesPulsar() {
  const { t } = useTranslation();
  const { id: connID } = useConnectionScope();

  const namespaces = usePulsarNamespaces();
  const [namespace, setNamespace] = useState("");
  const scope = namespace || (namespaces.data?.[0]?.name ?? "");
  const topics = usePulsarTopics(scope);

  const [topic, setTopic] = useState("");
  const [messageId, setMessageId] = useState("");
  const [messageKey, setMessageKey] = useState("");
  const [property, setProperty] = useState("");
  const [query, setQuery] = useState<PulsarQuery | null>(null);
  const [selected, setSelected] = useState<MessageItem | null>(null);

  const browse = usePulsarMessages(query, 200);

  const [tailing, setTailing] = useState(false);
  const [tailed, setTailed] = useState<MessageItem[]>([]);
  const cursor = useRef<TailCursor>({ positions: [] } as TailCursor);

  const options = (topics.data ?? []).map((entry) => ({
    value: topicURL(entry),
    label: entry.ref.name,
  }));
  const current = topic || (options[0]?.value ?? "");

  const propertyFilter = parsePropertyFilter(property, t);
  const invalidProperty =
    propertyFilter != null && "error" in propertyFilter ? propertyFilter.error : null;

  const search = () => {
    if (current === "" || invalidProperty != null) return;
    setTailing(false);
    setSelected(null);
    setQuery({
      topic: current,
      messageId,
      messageKey,
      property: propertyFilter != null && "filter" in propertyFilter ? propertyFilter.filter : "",
      startTimeMs: 0,
      endTimeMs: 0,
    });
  };

  const poll = useCallback(async () => {
    try {
      const batch = await pulsarTail(connID, current, cursor.current, 100);
      // The cursor is stored even when the batch was empty. A poll that threw
      // its cursor away would resolve "the end" again next time and silently
      // skip whatever arrived in between.
      cursor.current = batch.cursor;
      const arrived = (batch.messages ?? []).filter((item): item is MessageItem => item != null);
      if (arrived.length > 0) {
        setTailed((previous) => [...previous, ...arrived].slice(-TAIL_MAX_ROWS));
      }
    } catch (failure) {
      setTailing(false);
      toast.error(formatErrorMessage(failure));
    }
  }, [connID, current]);

  useEffect(() => {
    if (!tailing) return;
    const timer = setInterval(() => void poll(), TAIL_INTERVAL_MS);
    void poll();
    return () => clearInterval(timer);
  }, [tailing, poll]);

  const startTail = () => {
    if (current === "") return;
    setQuery(null);
    setSelected(null);
    setTailed([]);
    cursor.current = { positions: [] } as TailCursor;
    setTailing(true);
  };

  const rows = tailing ? tailed : (browse.data ?? []);

  return (
    <Page>
      <PageHeader title={t("board.messages.pulsar.title")} subtitle={scope} />
      <Toolbar>
        <SelectField
          value={scope}
          options={(namespaces.data ?? []).map((entry) => ({
            value: entry.name,
            label: entry.name,
          }))}
          onValueChange={(next) => {
            setNamespace(next);
            setTopic("");
            setQuery(null);
            setTailing(false);
          }}
        />
        <SelectField
          className="min-w-56"
          value={current}
          options={options}
          onValueChange={(next) => {
            setTopic(next);
            setQuery(null);
            setTailing(false);
          }}
        />
        <Input
          className="mono3 h-8 w-44"
          value={messageId}
          placeholder={t("board.messages.pulsar.idPlaceholder")}
          onChange={(event) => setMessageId(event.target.value)}
        />
        <Input
          className="mono3 h-8 w-36"
          value={messageKey}
          placeholder={t("board.messages.pulsar.keyPlaceholder")}
          onChange={(event) => setMessageKey(event.target.value)}
        />
        {/* Pulsar has no tag: this is what narrows a browse instead. */}
        <Input
          className="mono3 h-8 w-44"
          value={property}
          aria-invalid={invalidProperty != null}
          placeholder={t("board.messages.pulsar.propertyPlaceholder")}
          onChange={(event) => setProperty(event.target.value)}
        />
        <Button size="sm" onClick={search} disabled={current === "" || invalidProperty != null}>
          <Search size={14} aria-hidden />
          {t("board.messages.pulsar.search")}
        </Button>
        <Button
          size="sm"
          variant={tailing ? "destructive" : "outline"}
          onClick={() => (tailing ? setTailing(false) : startTail())}
          disabled={current === ""}
        >
          {tailing ? <Square size={14} aria-hidden /> : <Play size={14} aria-hidden />}
          {tailing ? t("board.messages.pulsar.stopTail") : t("board.messages.pulsar.tail")}
        </Button>
      </Toolbar>
      {invalidProperty != null && (
        <p className="px-5 text-xs text-(--c-err)">{invalidProperty}</p>
      )}

      <BoardState state={tailing ? { ...browse, loading: false, error: null } : browse}>
        <ListArea>
          <ListPane>
            <Panel>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("board.messages.pulsar.messageId")}</TableHead>
                    <TableHead>{t("board.messages.pulsar.key")}</TableHead>
                    <TableHead>{t("board.messages.pulsar.publishedAt")}</TableHead>
                    <TableHead>{t("board.messages.pulsar.redelivery")}</TableHead>
                    <TableHead>{t("board.messages.pulsar.body")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((message) => (
                    <TableRow
                      key={`${message.messageId}-${message.id}`}
                      data-state={selected?.messageId === message.messageId ? "selected" : undefined}
                      onClick={() => setSelected(message)}
                    >
                      <TableCell className="mono3">{message.messageId}</TableCell>
                      <TableCell className="mono3">{message.keys || "—"}</TableCell>
                      <TableCell className="mono3">{message.storeTime || "—"}</TableCell>
                      <TableCell>
                        {/* A message going round repeatedly is one about to be
                            dead-lettered, which is the most useful thing on a
                            browse of a topic somebody is debugging. */}
                        {redeliveryCount(message) > 0 ? (
                          <Status tone="warn">{redeliveryCount(message)}</Status>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="mono3 max-w-80 truncate">{message.body}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Panel>
          </ListPane>

          {selected != null && (
            <DetailPanel>
              <DetailPanelHeader
                title={selected.messageId}
                onClose={() => setSelected(null)}
              />
              <DetailPanelBody>
                <KV
                  rows={[
                    [t("board.messages.pulsar.topic"), <span className="mono3">{selected.topic}</span>],
                    [t("board.messages.pulsar.key"), <span className="mono3">{selected.keys || "—"}</span>],
                    [
                      t("board.messages.pulsar.orderingKey"),
                      <span className="mono3">{orderingKey(selected) || "—"}</span>,
                    ],
                    [t("board.messages.pulsar.producer"), <span className="mono3">{producerName(selected) || "—"}</span>],
                    [t("board.messages.pulsar.partition"), String(selected.queueId)],
                    [t("board.messages.pulsar.publishedAt"), selected.storeTime || "—"],
                    /* When the producer said the event happened, as opposed to
                       when the broker stored it. They differ on any pipeline
                       that buffers. */
                    [t("board.messages.pulsar.eventTime"), eventTime(selected) || "—"],
                    [t("board.messages.pulsar.redelivery"), String(redeliveryCount(selected))],
                  ]}
                />

                <SectionLabel>{t("board.messages.pulsar.properties")}</SectionLabel>
                {producerProperties(selected).length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("board.messages.pulsar.noProperties")}
                  </p>
                ) : (
                  <KV
                    rows={producerProperties(selected).map(([key, value]) => [
                      <span className="mono3">{key}</span>,
                      <span className="mono3">{value}</span>,
                    ])}
                  />
                )}

                <SectionLabel>{t("board.messages.pulsar.body")}</SectionLabel>
                <JsonBlock>{selected.body}</JsonBlock>
              </DetailPanelBody>
            </DetailPanel>
          )}
        </ListArea>
      </BoardState>
    </Page>
  );
}
