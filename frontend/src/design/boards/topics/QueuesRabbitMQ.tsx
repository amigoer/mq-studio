import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ListArea, ListPane, Page, PageHeader, RefreshButton, Toolbar } from "@/design/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
  DetailPanelFooter,
  DetailPanelHeader,
  KV,
  Panel,
  ProtoBadge,
  SectionLabel,
  SelectField,
  Status,
  toast,
  useConfirm,
} from "@/components";
import { BoardState, isBlocked } from "@/design/boards/BoardState";
import { StreamClientsPanel } from "./StreamClientsPanel";
import { useRabbitQueues } from "@/hooks/rabbitmq/useRabbitQueues";
import { formatBytes, formatCount, formatRate } from "@/lib/format";
import {
  argumentsOf,
  consumerUtilisation,
  featureTags,
  leader,
  memoryBytes,
  members,
  messageBytes,
  messagesReady,
  messagesUnacknowledged,
  onlineMembers,
  policy,
  queueType,
  node as queueNode,
  state as queueState,
  vhost,
} from "@/mq/rabbitmq/destinations";
import { useConnectionScope } from "@/mq/ConnectionScope";
import * as rabbitApi from "@/api/rabbitmq";
import { formatErrorMessage } from "@/lib/utils";
import { useRabbitRouting } from "@/hooks/rabbitmq/useRabbitRouting";
import { exchangeLabel } from "@/mq/rabbitmq/destinations";
import { QueueDialog } from "./QueueDialog";
import { MoveDialog } from "./MoveDialog";
import type { MoveRequest, QueueDeclaration } from "@/api/rabbitmq";
import type { Destination } from "@/api/models";

const TAG = { fontSize: "10px" } as const;
const MONO11 = { fontSize: "11px" } as const;

/** Ordered so the tags a reader scans for come first at any row width. */
const ALL_VHOSTS = "__all__";

/**
 * Board 4a — RabbitMQ queues.
 *
 * AMQP has no topic to map onto, so this is its own board rather than an
 * adaptation of the topic page: there is no partition count, no offset and no
 * consumer group, and the columns that matter instead are the ready/unacked
 * split and what the queue was declared with.
 *
 * The canvas drew a "new queue" button and purge and delete in the detail
 * footer. They are absent until the write operations land, because a control
 * that does nothing is worse than one that is not there.
 */
export function QueuesRabbitMQ() {
  const { t } = useTranslation();
  const state = useRabbitQueues();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [backlogOnly, setBacklogOnly] = useState(false);
  const [vhostFilter, setVhostFilter] = useState(ALL_VHOSTS);
  const [selected, setSelected] = useState<string | null>(null);
  const [declaring, setDeclaring] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);
  /* Only for the move dialog's target picker, so it is not loaded until the
     board is. It shares the routing read the exchanges board already does. */
  const routing = useRabbitRouting();

  const queues = useMemo(() => state.data ?? [], [state.data]);

  const vhosts = useMemo(() => {
    const found = new Set(queues.map((queue) => vhost(queue)).filter((name) => name !== ""));
    return [...found].sort();
  }, [queues]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return queues
      .filter((queue) => {
        if (vhostFilter !== ALL_VHOSTS && vhost(queue) !== vhostFilter) return false;
        if (backlogOnly && messagesReady(queue) + messagesUnacknowledged(queue) === 0) return false;
        return needle === "" || queue.ref.name.toLowerCase().includes(needle);
      })
      .sort(
        (left, right) =>
          messagesReady(right) + messagesUnacknowledged(right) -
          (messagesReady(left) + messagesUnacknowledged(left)),
      );
  }, [backlogOnly, queues, search, vhostFilter]);

  const detail = useMemo(
    () => rows.find((queue) => queueKey(queue) === selected) ?? null,
    [rows, selected],
  );

  /* The virtual host a new queue lands in. With a filter on it is that one;
     with none it is whichever the connection opened, which is what the
     existing queues already report. */
  const targetVhost =
    vhostFilter !== ALL_VHOSTS ? vhostFilter : (queues[0] != null ? vhost(queues[0]) : "/");

  const declare = useCallback(
    async (declaration: QueueDeclaration) => {
      await rabbitApi.declareQueue(connID, declaration);
      toast.success(t("board.topics.rabbitmq.declared", { name: declaration.name }));
      await state.refresh();
    },
    [connID, state, t],
  );

  const purge = useCallback(
    async (queue: Destination) => {
      const holding = messagesReady(queue) + messagesUnacknowledged(queue);
      const ok = await confirm({
        title: t("board.topics.rabbitmq.purgeTitle", { name: queue.ref.name }),
        description: t("board.topics.rabbitmq.purgeDesc", { count: holding }),
        confirmLabel: t("board.common.purge"),
        danger: true,
      });
      if (!ok) return;
      try {
        await rabbitApi.purgeQueue(connID, vhost(queue), queue.ref.name);
        toast.success(t("board.topics.rabbitmq.purged", { name: queue.ref.name }));
        await state.refresh();
      } catch (purgeError) {
        toast.error(t("board.topics.rabbitmq.purgeFailed"), {
          description: formatErrorMessage(purgeError),
        });
      }
    },
    [confirm, connID, state, t],
  );

  const move = useCallback(
    async (request: MoveRequest) => {
      const moved = await rabbitApi.moveMessages(connID, request);
      toast.success(t("board.topics.rabbitmq.moved", { count: moved }));
      await state.refresh();
    },
    [connID, state, t],
  );

  const rebalance = useCallback(async () => {
    const ok = await confirm({
      title: t("board.topics.rabbitmq.rebalanceTitle"),
      description: t("board.topics.rabbitmq.rebalanceDesc"),
      confirmLabel: t("board.topics.rabbitmq.rebalanceAction"),
    });
    if (!ok) return;
    try {
      await rabbitApi.rebalanceQueues(connID);
      toast.success(t("board.topics.rabbitmq.rebalanced"));
      await state.refresh();
    } catch (rebalanceError) {
      toast.error(t("board.topics.rabbitmq.rebalanceFailed"), {
        description: formatErrorMessage(rebalanceError),
      });
    }
  }, [confirm, connID, state, t]);

  const remove = useCallback(
    async (queue: Destination) => {
      const holding = messagesReady(queue) + messagesUnacknowledged(queue);
      const ok = await confirm({
        title: t("board.topics.rabbitmq.deleteTitle", { name: queue.ref.name }),
        /* The count is the whole warning. Deleting a queue discards what is in
           it, and the broker offers no undo. */
        description:
          holding > 0
            ? t("board.topics.rabbitmq.deleteHolding", { count: holding })
            : t("board.topics.rabbitmq.deleteEmpty"),
        confirmLabel: t("board.common.delete"),
        danger: true,
      });
      if (!ok) return;
      try {
        await rabbitApi.deleteQueue(connID, vhost(queue), queue.ref.name);
        toast.success(t("board.topics.rabbitmq.deleted", { name: queue.ref.name }));
        setSelected(null);
        await state.refresh();
      } catch (deleteError) {
        toast.error(t("board.topics.rabbitmq.deleteFailed"), {
          description: formatErrorMessage(deleteError),
        });
      }
    },
    [confirm, connID, state, t],
  );

  return (
    <Page>
      <PageHeader
        title={t("board.common.queue")}
        subtitle={t("board.topics.rabbitmq.queueSubtitle", { count: queues.length })}
        actions={
          <>
            {/* Leaders pile up on whichever node was available when each queue
                was declared, and nothing spreads them back on its own. */}
            <Button variant="outline" disabled={!state.online} onClick={() => void rebalance()}>
              {t("board.topics.rabbitmq.rebalanceAction")}
            </Button>
            <Button disabled={!state.online} onClick={() => setDeclaring(true)}>
              {t("board.topics.rabbitmq.newQueue")}
            </Button>
            <RefreshButton
              refreshing={state.refreshing}
              online={state.online}
              onClick={state.refresh}
            />
          </>
        }
      />
      <QueueDialog
        open={declaring}
        vhost={targetVhost}
        onClose={() => setDeclaring(false)}
        onSubmit={declare}
      />
      <MoveDialog
        open={moving != null}
        vhost={targetVhost}
        from={moving ?? ""}
        queues={queues.map((found) => found.ref.name)}
        exchanges={(routing.data?.exchanges ?? []).map(exchangeLabel)}
        onClose={() => setMoving(null)}
        onSubmit={move}
      />
      {!isBlocked(state) && (
        <Toolbar>
          <Input
            className="w-[220px] flex-none"
            placeholder={t("board.topics.rabbitmq.searchQueue")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {vhosts.length > 1 && (
            <SelectField
              value={vhostFilter}
              prefix="vhost："
              onValueChange={setVhostFilter}
              options={[
                { value: ALL_VHOSTS, label: t("board.common.all") },
                ...vhosts.map((name) => ({ value: name })),
              ]}
            />
          )}
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "11.5px",
              color: "var(--c-mono-dim)",
            }}
          >
            <Switch checked={backlogOnly} onCheckedChange={setBacklogOnly} />
            {t("board.topics.rabbitmq.backlogOnly")}
          </span>
          <span className="flex-1" />
          <span style={{ fontSize: "11.5px", color: "var(--c-muted)" }}>
            {t("board.topics.rabbitmq.shown", { shown: rows.length, total: queues.length })}
          </span>
        </Toolbar>
      )}
      <ListArea>
        <ListPane>
          <BoardState
            state={state}
            empty={queues.length === 0 ? t("board.topics.rabbitmq.noQueues") : undefined}
          >
            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("board.common.queue")}</TableHead>
                  <TableHead>{t("board.common.type")}</TableHead>
                  <TableHead style={{ textAlign: "right" }}>Ready</TableHead>
                  <TableHead style={{ textAlign: "right" }}>Unacked</TableHead>
                  <TableHead style={{ textAlign: "right" }}>
                    {t("board.common.consumers")}
                  </TableHead>
                  <TableHead style={{ textAlign: "right" }}>
                    {t("board.topics.rabbitmq.inOutRate")}
                  </TableHead>
                  <TableHead>{t("board.common.features")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((queue) => {
                  const ready = messagesReady(queue);
                  const unacked = messagesUnacknowledged(queue);
                  const key = queueKey(queue);
                  return (
                    <TableRow
                      key={key}
                      selected={selected === key}
                      onClick={() => setSelected(key)}
                    >
                      <TableCell>
                        <b style={{ fontWeight: 500 }}>{queue.ref.name}</b>
                        {vhosts.length > 1 && (
                          <span
                            className="mono3"
                            style={{ marginLeft: "6px", fontSize: "10.5px", color: "var(--c-muted)" }}
                          >
                            {vhost(queue)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{queueType(queue)}</TableCell>
                      <TableCell
                        className="mono3"
                        style={{
                          textAlign: "right",
                          color: ready > 0 ? "var(--c-warn-text)" : undefined,
                        }}
                      >
                        {formatCount(ready)}
                      </TableCell>
                      <TableCell className="mono3" style={{ textAlign: "right" }}>
                        {formatCount(unacked)}
                      </TableCell>
                      <TableCell
                        className="mono3"
                        style={{
                          textAlign: "right",
                          color:
                            ready > 0 && queue.subscribers === 0 ? "var(--c-err-text)" : undefined,
                        }}
                      >
                        {formatCount(queue.subscribers)}
                      </TableCell>
                      <TableCell className="mono3" style={{ textAlign: "right" }}>
                        {formatRate(queue.rateIn)} / {formatRate(queue.rateOut)}
                      </TableCell>
                      <TableCell>
                        {featureTags(queue).map((tag) => (
                          <Status key={tag} tone="off" style={TAG}>
                            {tag}
                          </Status>
                        ))}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length === 0 && queues.length > 0 && (
                  <TableRow>
                    <TableCell colSpan={7} style={{ color: "var(--c-muted)" }}>
                      {t("board.topics.rabbitmq.noMatch")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </BoardState>
        </ListPane>

        {detail != null && (
          <DetailPanel width={370} onDismiss={() => setSelected(null)}>
            <DetailPanelHeader
              title={detail.ref.name}
              badge={<ProtoBadge protocol="rabbitmq" label={queueType(detail)} />}
              onClose={() => setSelected(null)}
            />
            <DetailPanelBody>
              <QueueDetail queue={detail} />
            </DetailPanelBody>
            <DetailPanelFooter>
              <Button variant="outline" onClick={() => setMoving(detail.ref.name)}>
                {t("board.topics.rabbitmq.moveAction")}
              </Button>
              <span className="flex-1" />
              <Button variant="destructive" onClick={() => void purge(detail)}>
                {t("board.common.purge")}
              </Button>
              <Button variant="destructive" onClick={() => void remove(detail)}>
                {t("board.common.delete")}
              </Button>
            </DetailPanelFooter>
          </DetailPanel>
        )}
      </ListArea>
    </Page>
  );
}

/** A queue is unique per virtual host, not per broker. */
function queueKey(queue: Destination): string {
  return `${queue.ref.namespace}/${queue.ref.name}`;
}

/**
 * The declared arguments, labelled where the name is jargon.
 *
 * Anything the broker carries that is not in this list is still shown, under
 * its own key: a queue can be declared with arguments a plugin understands and
 * this app has never heard of, and hiding them would make the panel a lie
 * about what the queue is.
 */
const ARG_LABELS: Record<string, string> = {
  "x-message-ttl": "board.topics.rabbitmq.messageTtl",
  "x-expires": "board.topics.rabbitmq.expires",
  "x-dead-letter-exchange": "board.topics.rabbitmq.dlx",
  "x-dead-letter-routing-key": "board.topics.rabbitmq.dlxRoutingKey",
  "x-max-length": "board.topics.rabbitmq.maxLength",
  "x-max-length-bytes": "board.topics.rabbitmq.maxLengthBytes",
  "x-overflow": "board.topics.rabbitmq.overflow",
  "x-max-priority": "board.topics.rabbitmq.maxPriority",
  "x-single-active-consumer": "board.topics.rabbitmq.singleActive",
};

function QueueDetail({ queue }: { queue: Destination }) {
  const { t } = useTranslation();
  const ready = messagesReady(queue);
  const unacked = messagesUnacknowledged(queue);
  const args = argumentsOf(queue);
  const utilisation = consumerUtilisation(queue);
  const replicas = members(queue);
  const online = onlineMembers(queue);
  const matched = policy(queue);

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
        <Counter label="Ready" value={formatCount(ready)} tone={ready > 0 ? "warn" : undefined} />
        <Counter label="Unacked" value={formatCount(unacked)} />
      </div>

      <KV
        rows={[
          [t("board.common.persistence"), queue.attributes?.durable === "true" ? "durable" : "transient"],
          [t("board.common.status"), queueState(queue) || "—"],
          [t("board.common.node"), <span key="n" className="mono3" style={MONO11}>{queueNode(queue) || "—"}</span>],
          [t("board.topics.rabbitmq.messageBytes"), formatBytes(messageBytes(queue))],
          [t("board.topics.rabbitmq.queueMemory"), formatBytes(memoryBytes(queue))],
          ...(utilisation != null
            ? [[
                t("board.topics.rabbitmq.utilisation"),
                `${Math.round(utilisation * 100)}%`,
              ] as const]
            : []),
          ...(matched !== ""
            ? [[t("board.topics.rabbitmq.policy"), matched] as const]
            : []),
        ]}
      />

      {/* Only a stream has clients on a protocol of its own, and they are
          invisible everywhere else in this app. */}
      {queueType(queue) === "stream" && (
        <StreamClientsPanel vhost={vhost(queue)} name={queue.ref.name} />
      )}

      {/* Replication, for the queue types that have it. A classic queue lives
          on one node and reports none of this. */}
      {replicas.length > 0 && (
        <div>
          <SectionLabel style={{ marginBottom: "6px" }}>
            {t("board.topics.rabbitmq.replication")}
          </SectionLabel>
          <Panel style={{ padding: "9px 12px", display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ fontSize: "11.5px" }}>
              {t("board.topics.rabbitmq.leader")}{" "}
              <span className="mono3" style={MONO11}>{leader(queue) || "—"}</span>
            </div>
            {replicas.map((member) => (
              <div key={member} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <Status tone={online.includes(member) ? "ok" : "err"} style={TAG}>
                  {online.includes(member)
                    ? t("board.topics.rabbitmq.memberOnline")
                    : t("board.topics.rabbitmq.memberDown")}
                </Status>
                <span className="mono3" style={MONO11}>{member}</span>
              </div>
            ))}
          </Panel>
        </div>
      )}

      <div>
        <SectionLabel style={{ marginBottom: "6px" }}>
          {t("board.topics.rabbitmq.arguments")}
        </SectionLabel>
        {Object.keys(args).length === 0 ? (
          <Panel style={{ padding: "9px 12px", fontSize: "11.5px", color: "var(--c-muted)" }}>
            {t("board.topics.rabbitmq.noArguments")}
          </Panel>
        ) : (
          <KV
            rows={Object.entries(args).map(([key, value]) => [
              ARG_LABELS[key] != null ? t(ARG_LABELS[key]) : key,
              <span key={key} className="mono3" style={MONO11}>
                {formatArgument(value)}
              </span>,
            ])}
          />
        )}
      </div>
    </>
  );
}

function Counter({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <Panel style={{ padding: "9px 12px" }}>
      <div style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>{label}</div>
      <div
        className="mono3"
        style={{
          fontSize: "16px",
          fontWeight: 600,
          marginTop: "2px",
          color: tone === "warn" ? "var(--c-warn-text)" : undefined,
        }}
      >
        {value}
      </div>
    </Panel>
  );
}

/** An argument can be a number, a string, a boolean or a nested table. */
function formatArgument(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
