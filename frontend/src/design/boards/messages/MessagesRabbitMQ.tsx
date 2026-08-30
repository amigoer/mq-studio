import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { ListArea, ListPane, Page, PageHeader, Toolbar } from "@/design/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Combobox,
  DetailPanel,
  DetailPanelBody,
  DetailPanelHeader,
  JsonBlock,
  KV,
  Panel,
  SectionLabel,
  SelectField,
  Status,
  WarnBanner,
} from "@/components";
import { BoardState } from "@/design/boards/BoardState";
import { useRabbitMessages } from "@/hooks/rabbitmq/useRabbitMessages";
import { useRabbitQueues } from "@/hooks/rabbitmq/useRabbitQueues";
import { formatCount } from "@/lib/format";
import {
  amqpProperties,
  deathCount,
  deathQueue,
  deathReason,
  exchange,
  headers,
  persistent,
  redelivered,
  routingKey,
} from "@/mq/rabbitmq/messages";
import { messagesReady, messagesUnacknowledged } from "@/mq/rabbitmq/destinations";
import type { MessageItem } from "@/api/models";

const MONO11 = { fontSize: "11px" } as const;
const COUNTS = ["10", "32", "100", "500"] as const;

/**
 * Board 4e - RabbitMQ messages.
 *
 * Browsing over AMQP rather than the management API's get endpoint, which
 * buys three things the canvas could not have: headers keep their AMQP types
 * instead of whatever JSON made of them, payloads are not truncated at fifty
 * kilobytes, and a filter is possible at all.
 *
 * It still alters the queue, and the banner says so rather than letting an
 * operator find out. AMQP has no non-destructive read of a classic or quorum
 * queue: everything taken is put back with nack, keeping its position, but it
 * comes back flagged redelivered and a concurrent consumer sees the gap.
 *
 * The canvas drew republish and ack-and-remove in the footer. They arrive with
 * the write operations.
 */
export function MessagesRabbitMQ() {
  const { t } = useTranslation();
  const queues = useRabbitQueues();
  const [queue, setQueue] = useState("");
  const [count, setCount] = useState<string>("32");
  const [routingFilter, setRoutingFilter] = useState("");
  const [bodyFilter, setBodyFilter] = useState("");
  const [headerFilter, setHeaderFilter] = useState("");
  const [selected, setSelected] = useState<number | null>(null);

  const messages = useRabbitMessages();
  const running = messages.running;

  const options = useMemo(
    () =>
      (queues.data ?? []).map((found) => ({
        value: found.ref.name,
        // The depth belongs in the label: picking a queue to browse is a
        // choice between them, and which is holding anything is the fact that
        // decides it.
        label: t("board.messages.rabbitmq.queueOption", {
          name: found.ref.name,
          ready: messagesReady(found),
          unacked: messagesUnacknowledged(found),
        }),
      })),
    [queues.data, t],
  );

  const fetch = useCallback(() => {
    if (queue === "") return;
    setSelected(null);
    void messages.browse({
      queue,
      count: Number.parseInt(count, 10),
      routingKey: routingFilter,
      body: bodyFilter,
      header: headerFilter,
    });
  }, [bodyFilter, count, headerFilter, messages, queue, routingFilter]);

  const rows = messages.items;
  const detail = rows.find((message) => message.id === selected) ?? null;

  return (
    <Page>
      <PageHeader
        title={t("board.messages.rabbitmq.title")}
        subtitle={t("board.messages.rabbitmq.subtitle")}
      />
      {/* Browsing is a write in disguise. Saying so once at the top is the
          honest place for it - the alternative is an operator discovering it
          from a monitoring alert. */}
      <WarnBanner>{t("board.messages.rabbitmq.ackWarn")}</WarnBanner>
      <Toolbar>
        <Combobox
          value={queue}
          onValueChange={setQueue}
          options={options}
          placeholder={t("board.messages.rabbitmq.queue")}
          className="w-[240px]"
        />
        <SelectField
          value={count}
          prefix={t("board.messages.rabbitmq.countPrefix")}
          onValueChange={setCount}
          options={COUNTS.map((value) => ({ value }))}
        />
        <Input
          className="w-[150px] flex-none"
          placeholder={t("board.messages.rabbitmq.routingFilter")}
          value={routingFilter}
          onChange={(event) => setRoutingFilter(event.target.value)}
        />
        <Input
          className="w-[150px] flex-none"
          placeholder={t("board.messages.rabbitmq.headerFilter")}
          value={headerFilter}
          onChange={(event) => setHeaderFilter(event.target.value)}
        />
        <Input
          className="w-[150px] flex-none"
          placeholder={t("board.messages.rabbitmq.bodyFilter")}
          value={bodyFilter}
          onChange={(event) => setBodyFilter(event.target.value)}
        />
        <Button disabled={queue === "" || running} onClick={fetch}>
          {running ? <Spinner /> : <Search size={13} aria-hidden />}
          {t("board.messages.rabbitmq.fetch")}
        </Button>
        <span className="flex-1" />
        {messages.lastCount != null && (
          <span style={{ fontSize: "11.5px", color: "var(--c-muted)" }}>
            {t("board.messages.rabbitmq.fetched", { count: messages.lastCount })}
          </span>
        )}
      </Toolbar>
      <ListArea>
        <ListPane>
          <BoardState
            state={messages.state}
            empty={
              messages.lastCount === 0
                ? t("board.messages.rabbitmq.nothingMatched")
                : messages.lastCount == null
                  ? t("board.messages.rabbitmq.pickAQueue")
                  : undefined
            }
          >
            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead style={{ width: "48px" }}>#</TableHead>
                  <TableHead>{t("board.messages.rabbitmq.routingKey")}</TableHead>
                  <TableHead>{t("board.common.exchange")}</TableHead>
                  <TableHead>{t("board.messages.rabbitmq.payload")}</TableHead>
                  <TableHead>{t("board.common.features")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((message) => (
                  <TableRow
                    key={message.id}
                    selected={selected === message.id}
                    onClick={() => setSelected(message.id)}
                  >
                    <TableCell className="mono3" style={{ color: "var(--c-muted)" }}>
                      {message.id}
                    </TableCell>
                    <TableCell className="mono3" style={MONO11}>
                      {routingKey(message) || "-"}
                    </TableCell>
                    <TableCell className="mono3" style={MONO11}>
                      {exchange(message) || t("board.messages.rabbitmq.defaultExchange")}
                    </TableCell>
                    <TableCell style={{ color: "var(--c-mono-dim)" }}>
                      {preview(message.body)}
                    </TableCell>
                    <TableCell>
                      {redelivered(message) && (
                        <Status tone="warn" style={{ fontSize: "10px" }}>
                          {t("board.common.redeliver")}
                        </Status>
                      )}
                      {!persistent(message) && (
                        <Status tone="off" style={{ fontSize: "10px" }}>
                          transient
                        </Status>
                      )}
                      {deathCount(message) != null && (
                        <Status tone="err" style={{ fontSize: "10px" }}>
                          x-death {deathCount(message)}
                        </Status>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </BoardState>
        </ListPane>

        {detail != null && (
          <DetailPanel width={420} onDismiss={() => setSelected(null)}>
            <DetailPanelHeader
              title={`#${detail.id}`}
              onClose={() => setSelected(null)}
            />
            <DetailPanelBody>
              <MessageDetail message={detail} />
            </DetailPanelBody>
          </DetailPanel>
        )}
      </ListArea>
    </Page>
  );
}

function MessageDetail({ message }: { message: MessageItem }) {
  const { t } = useTranslation();
  const applicationHeaders = headers(message);
  const properties = amqpProperties(message);
  const died = deathCount(message);

  return (
    <>
      {/* A dead-lettered message carries its whole history in x-death, and
          that history is the answer to why it is where it is. */}
      {died != null && (
        <Panel
          style={{
            padding: "9px 12px",
            borderColor: "var(--c-err)",
            fontSize: "11.5px",
            color: "var(--c-err-text)",
          }}
        >
          {t("board.messages.rabbitmq.xdeath", {
            count: died,
            queue: deathQueue(message) || "?",
            reason: deathReason(message) || "?",
          })}
        </Panel>
      )}

      <KV
        rows={[
          [
            t("board.messages.rabbitmq.routingKey"),
            <span key="rk" className="mono3" style={MONO11}>
              {routingKey(message) || "-"}
            </span>,
          ],
          [
            t("board.common.exchange"),
            <span key="ex" className="mono3" style={MONO11}>
              {exchange(message) || t("board.messages.rabbitmq.defaultExchange")}
            </span>,
          ],
          [
            t("board.common.persistence"),
            persistent(message)
              ? "persistent"
              : t("board.messages.rabbitmq.transientWarn"),
          ],
          [t("board.common.redeliver"), redelivered(message) ? "yes" : "no"],
          ...(message.messageId !== ""
            ? ([["message-id", message.messageId]] as const)
            : []),
          ...(message.storeTime !== ""
            ? ([[t("board.messages.rabbitmq.timestamp"), message.storeTime]] as const)
            : []),
        ]}
      />

      <div>
        <SectionLabel style={{ marginBottom: "6px" }}>
          {t("board.messages.rabbitmq.amqpProperties")}
        </SectionLabel>
        <KV
          rows={Object.entries(properties).map(([key, value]) => [
            key,
            <span key={key} className="mono3" style={MONO11}>
              {value}
            </span>,
          ])}
        />
      </div>

      <div>
        <SectionLabel style={{ marginBottom: "6px" }}>
          {t("board.messages.rabbitmq.headers", {
            count: Object.keys(applicationHeaders).length,
          })}
        </SectionLabel>
        {Object.keys(applicationHeaders).length === 0 ? (
          <Panel style={{ padding: "9px 12px", fontSize: "11.5px", color: "var(--c-muted)" }}>
            {t("board.messages.rabbitmq.noHeaders")}
          </Panel>
        ) : (
          <KV
            rows={Object.entries(applicationHeaders).map(([key, value]) => [
              key,
              <span key={key} className="mono3" style={MONO11}>
                {value}
              </span>,
            ])}
          />
        )}
      </div>

      <div>
        <SectionLabel style={{ marginBottom: "6px" }}>
          {t("board.messages.rabbitmq.payload", {
            bytes: formatCount(byteLength(message.body)),
          })}
        </SectionLabel>
        {/* JsonBlock pretty-prints what parses and shows the rest verbatim,
            which is right here: a message's content type is a claim by the
            publisher and is routinely wrong or absent. */}
        <JsonBlock>{message.body}</JsonBlock>
      </div>
    </>
  );
}

/** The first line of a payload, for a row that has one column for it. */
function preview(body: string): string {
  const firstLine = body.split("\n", 1)[0] ?? "";
  return firstLine.length > 90 ? `${firstLine.slice(0, 90)}…` : firstLine;
}

/** Payload size in bytes, not characters: a multi-byte body is bigger than it looks. */
function byteLength(body: string): number {
  return new TextEncoder().encode(body).length;
}
