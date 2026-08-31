import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Search } from "lucide-react";
import { ListArea, ListPane, Page, PageHeader, RefreshButton, Toolbar } from "@/design/shell";
import { Button } from "@/components/ui/button";
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
  JsonBlock,
  KV,
  Panel,
  SectionLabel,
  SelectField,
  Status,
  WarnBanner,
  toast,
  useConfirm,
} from "@/components";
import { BoardState } from "@/design/boards/BoardState";
import { useRabbitDeadLetters } from "@/hooks/rabbitmq/useRabbitDeadLetters";
import { useRabbitMessages } from "@/hooks/rabbitmq/useRabbitMessages";
import { formatCount } from "@/lib/format";
import {
  deathCount,
  deathQueue,
  deathReason,
  exchange,
  headers,
  routingKey,
} from "@/mq/rabbitmq/messages";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { useRabbitQueues } from "@/hooks/rabbitmq/useRabbitQueues";
import * as rabbitApi from "@/api/rabbitmq";
import { formatErrorMessage } from "@/lib/utils";
import { MoveDialog } from "@/design/boards/topics/MoveDialog";
import type { MoveRequest } from "@/api/rabbitmq";
import type { DeadLetterQueue } from "@/api/rabbitmq";
import type { MessageItem } from "@/api/models";

const MONO11 = { fontSize: "11px" } as const;
const COUNTS = ["10", "50", "200"] as const;

/**
 * Board 4f - RabbitMQ dead letters.
 *
 * There is no dead-letter queue on a RabbitMQ broker, strictly. What exists is
 * a queue declared with a dead-letter exchange, an exchange that routes like
 * any other, and whatever it lands in - which becomes a dead-letter queue by
 * convention rather than by declaration. So this page is a topology walk
 * first: which queues receive dead letters, and which queues feed them.
 *
 * That is why the source list is on every row. A dead-letter queue on its own
 * says how many messages failed; knowing which queues dead-letter into it is
 * what says where to look.
 *
 * Two actions, and the difference between them is the whole page. Republishing
 * sends a batch back where it came from - the target opens on the queue the
 * messages died in, read from their own x-death history. Dropping
 * acknowledges them, which discards them from the broker with no
 * dead-lettering and no copy anywhere.
 *
 * Export is not offered. The canvas drew it, and a file of message bodies with
 * no headers and no routing keys is not something anything can read back.
 */
export function DlqRabbitMQ() {
  const { t } = useTranslation();
  const topology = useRabbitDeadLetters();
  const messages = useRabbitMessages();
  const allQueues = useRabbitQueues();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();
  const [queue, setQueue] = useState("");
  const [count, setCount] = useState<string>("50");
  const [selected, setSelected] = useState<number | null>(null);
  const [republishing, setRepublishing] = useState(false);

  const queues = useMemo(() => topology.data ?? [], [topology.data]);
  const chosen = queues.find((found) => found.name === queue) ?? null;

  const fetch = useCallback(() => {
    if (queue === "") return;
    setSelected(null);
    void messages.browse({ queue, count: Number.parseInt(count, 10) });
  }, [count, messages, queue]);

  const rows = messages.items;
  const detail = rows.find((message) => message.id === selected) ?? null;

  /* The queue these dead letters came from, when they all agree on one. It is
     the obvious republish target and the dialog opens on it. */
  const origins = new Set(rows.map(deathQueue).filter((name) => name !== ""));
  const singleOrigin = origins.size === 1 ? [...origins][0] : undefined;

  const republish = useCallback(
    async (request: MoveRequest) => {
      const moved = await rabbitApi.moveMessages(connID, request);
      toast.success(t("board.dlq.rabbitmq.republished", { count: moved }));
      await topology.refresh();
      if (queue !== "") {
        void messages.browse({ queue, count: Number.parseInt(count, 10) });
      }
    },
    [connID, count, messages, queue, t, topology],
  );

  const drop = useCallback(async () => {
    if (chosen == null) return;
    const batch = Number.parseInt(count, 10);
    const ok = await confirm({
      title: t("board.dlq.rabbitmq.dropTitle", { name: chosen.name }),
      /* Acknowledging is what discards. The messages are gone from the broker
         with no dead-lettering and no copy anywhere. */
      description: t("board.dlq.rabbitmq.dropDesc", { count: batch }),
      confirmLabel: t("board.dlq.rabbitmq.drop"),
      danger: true,
    });
    if (!ok) return;
    try {
      const dropped = await rabbitApi.dropMessages(connID, chosen.namespace, chosen.name, batch);
      toast.success(t("board.dlq.rabbitmq.dropped", { count: dropped }));
      await topology.refresh();
      void messages.browse({ queue: chosen.name, count: batch });
    } catch (dropError) {
      toast.error(t("board.dlq.rabbitmq.dropFailed"), {
        description: formatErrorMessage(dropError),
      });
    }
  }, [chosen, confirm, connID, count, messages, t, topology]);

  return (
    <Page>
      <PageHeader
        title={t("board.dlq.rabbitmq.title")}
        subtitle={t("board.dlq.rabbitmq.subtitle", { count: queues.length })}
        actions={
          <RefreshButton
            refreshing={topology.refreshing}
            online={topology.online}
            onClick={topology.refresh}
          />
        }
      />
      {/* Reading a dead-letter queue is the same browse as any other, with
          the same consequence. */}
      <WarnBanner>{t("board.dlq.rabbitmq.browseWarn")}</WarnBanner>
      <Toolbar>
        <Combobox
          value={queue}
          onValueChange={setQueue}
          options={queues.map((found) => ({
            value: found.name,
            label: t("board.dlq.rabbitmq.queueOption", {
              name: found.name,
              depth: found.depth,
            }),
          }))}
          placeholder={t("board.dlq.rabbitmq.queue")}
          className="w-[260px]"
        />
        <SelectField
          value={count}
          prefix={t("board.dlq.rabbitmq.countPrefix")}
          onValueChange={setCount}
          options={COUNTS.map((value) => ({ value }))}
        />
        <Button disabled={queue === "" || messages.running} onClick={fetch}>
          {messages.running ? <Spinner /> : <Search size={13} aria-hidden />}
          {t("board.dlq.rabbitmq.fetch")}
        </Button>
        <Button
          variant="outline"
          disabled={chosen == null}
          onClick={() => setRepublishing(true)}
        >
          {t("board.dlq.rabbitmq.republish")}
        </Button>
        <Button variant="destructive" disabled={chosen == null} onClick={() => void drop()}>
          {t("board.dlq.rabbitmq.drop")}
        </Button>
        <span className="flex-1" />
        {messages.lastCount != null && (
          <span style={{ fontSize: "11.5px", color: "var(--c-muted)" }}>
            {/* "Taken N" rather than a queue total: a browse returns a page,
                and the depth is on the queue row above. */}
            {t("board.dlq.rabbitmq.taken", { count: messages.lastCount })}
          </span>
        )}
      </Toolbar>
      <MoveDialog
        open={republishing}
        vhost={chosen?.namespace ?? "/"}
        from={chosen?.name ?? ""}
        queues={(allQueues.data ?? []).map((found) => found.ref.name)}
        exchanges={[]}
        defaultTargetQueue={singleOrigin}
        onClose={() => setRepublishing(false)}
        onSubmit={republish}
      />
      <ListArea>
        <ListPane>
          <BoardState
            state={topology}
            empty={queues.length === 0 ? t("board.dlq.rabbitmq.none") : undefined}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "10px" }}>
              {queues.map((found) => (
                <DeadLetterCard
                  key={`${found.namespace}/${found.name}`}
                  queue={found}
                  selected={found.name === queue}
                  onSelect={() => setQueue(found.name)}
                />
              ))}
            </div>

            {chosen != null && (
              <div style={{ padding: "0 10px 10px" }}>
                <SectionLabel style={{ margin: "6px 0" }}>
                  {t("board.dlq.rabbitmq.messagesIn", { queue: chosen.name })}
                </SectionLabel>
                {messages.state.error != null ? (
                  <Panel style={{ padding: "10px 14px", fontSize: "11.5px", color: "var(--c-err-text)" }}>
                    {messages.state.error}
                  </Panel>
                ) : rows.length === 0 ? (
                  <Panel style={{ padding: "10px 14px", fontSize: "11.5px", color: "var(--c-muted)" }}>
                    {messages.lastCount === 0
                      ? t("board.dlq.rabbitmq.nothingTaken")
                      : t("board.dlq.rabbitmq.pressFetch")}
                  </Panel>
                ) : (
                  <Panel style={{ padding: "4px 0" }}>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead style={{ width: "48px" }}>#</TableHead>
                          <TableHead>{t("board.dlq.rabbitmq.originQueue")}</TableHead>
                          <TableHead>{t("board.common.reason")}</TableHead>
                          <TableHead style={{ textAlign: "right" }}>
                            {t("board.dlq.rabbitmq.deaths")}
                          </TableHead>
                          <TableHead>{t("board.messages.rabbitmq.routingKey")}</TableHead>
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
                              {deathQueue(message) || t("board.dlq.rabbitmq.unknownOrigin")}
                            </TableCell>
                            <TableCell>
                              <ReasonTag reason={deathReason(message)} />
                            </TableCell>
                            <TableCell className="mono3" style={{ textAlign: "right" }}>
                              {deathCount(message) ?? "-"}
                            </TableCell>
                            <TableCell className="mono3" style={MONO11}>
                              {routingKey(message) || "-"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Panel>
                )}
              </div>
            )}

            {detail != null && <DeadMessageDetail message={detail} />}
          </BoardState>
        </ListPane>
      </ListArea>
    </Page>
  );
}

function DeadLetterCard({
  queue,
  selected,
  onSelect,
}: {
  queue: DeadLetterQueue;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Panel
      onClick={onSelect}
      style={{
        padding: "10px 14px",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        cursor: "pointer",
        borderColor: selected ? "var(--c-accent)" : undefined,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <b style={{ fontWeight: 500 }}>{queue.name}</b>
        <span className="mono3" style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>
          {queue.namespace}
        </span>
        <span
          className="mono3"
          style={{
            fontSize: "12px",
            color: queue.depth > 0 ? "var(--c-err-text)" : "var(--c-muted)",
          }}
        >
          {formatCount(queue.depth)}
        </span>
        {/* A dead-letter queue with a consumer is a retry pipeline. One
            without is a backlog nobody is looking at, which is the case worth
            surfacing. */}
        {queue.consumers === 0 && queue.depth > 0 && (
          <Status tone="err" style={{ fontSize: "10px" }}>
            {t("board.dlq.rabbitmq.noConsumer")}
          </Status>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "3px", fontSize: "11px" }}>
        {(queue.sources ?? []).map((source) => (
          <div
            key={`${source?.queue}/${source?.exchange}/${source?.routingKey}`}
            style={{ display: "flex", alignItems: "center", gap: "5px", color: "var(--c-mono-dim)" }}
          >
            <span className="mono3">{source?.queue}</span>
            <ArrowRight size={11} aria-hidden style={{ flex: "none" }} />
            <span className="mono3">{source?.exchange || t("board.dlq.rabbitmq.defaultExchange")}</span>
            <span className="mono3">
              {/* An empty dead-letter routing key means the message keeps its
                  original one, which changes where it lands. */}
              {source?.routingKey
                ? `rk = ${source.routingKey}`
                : t("board.dlq.rabbitmq.keepsRoutingKey")}
            </span>
          </div>
        ))}
        {(queue.sources ?? []).length === 0 && (
          <span style={{ color: "var(--c-muted)" }}>{t("board.dlq.rabbitmq.noSources")}</span>
        )}
      </div>
    </Panel>
  );
}

/**
 * Why a message died, in the broker's own words.
 *
 * The four reasons mean genuinely different things and lead to different
 * fixes, so they are not collapsed into "failed".
 */
function ReasonTag({ reason }: { reason: string }) {
  const { t } = useTranslation();
  if (reason === "") return <span style={{ color: "var(--c-muted)" }}>-</span>;
  const tone = reason === "expired" || reason === "maxlen" ? "warn" : "err";
  return (
    <Status tone={tone} style={{ fontSize: "10px" }}>
      {t(`board.dlq.rabbitmq.reasons.${reason}`, reason)}
    </Status>
  );
}

function DeadMessageDetail({ message }: { message: MessageItem }) {
  const { t } = useTranslation();
  const applicationHeaders = headers(message);
  return (
    <div style={{ padding: "0 10px 14px" }}>
      <SectionLabel style={{ margin: "6px 0" }}>
        {t("board.dlq.rabbitmq.detail", { id: message.id })}
      </SectionLabel>
      <Panel style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <KV
          rows={[
            [t("board.dlq.rabbitmq.originQueue"), deathQueue(message) || "-"],
            [t("board.common.reason"), deathReason(message) || "-"],
            [t("board.dlq.rabbitmq.deaths"), String(deathCount(message) ?? "-")],
            [
              t("board.common.exchange"),
              <span key="ex" className="mono3" style={MONO11}>
                {exchange(message) || t("board.dlq.rabbitmq.defaultExchange")}
              </span>,
            ],
            [
              t("board.messages.rabbitmq.routingKey"),
              <span key="rk" className="mono3" style={MONO11}>
                {routingKey(message) || "-"}
              </span>,
            ],
          ]}
        />
        {Object.keys(applicationHeaders).length > 0 && (
          <KV
            rows={Object.entries(applicationHeaders).map(([key, value]) => [
              key,
              <span key={key} className="mono3" style={MONO11}>
                {value}
              </span>,
            ])}
          />
        )}
        <JsonBlock>{message.body}</JsonBlock>
      </Panel>
    </div>
  );
}
