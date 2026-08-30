import { Fragment, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { ListArea, ListPane, Page, PageHeader, Toolbar } from "@/design/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
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
  MiniStat,
  Panel,
  SectionLabel,
  SelectField,
  Status,
  useConfirm,
  useToast,
} from "@/components";
import { BoardState, Notice, isBlocked } from "@/design/boards/BoardState";
import { useBrokerData } from "@/hooks/useBrokerData";
import { useSettings } from "@/hooks/useSettings";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { useCapabilities } from "@/mq/capabilities";
import { Capability } from "@bindings/model/models";
import { CloneOffsetDialog } from "./CloneOffsetDialog";
import { QueueOffsetDialog, type QueueTarget } from "./QueueOffsetDialog";
import { ResetOffsetDialog } from "./ResetOffsetDialog";
import * as consumerApi from "@/api/consumer";
import { formatMessageTime } from "@/lib/time";
import { formatErrorMessage } from "@/lib/utils";
import type { Subscription } from "@/api/models";
import {
  ConsumeMode,
  clientsOf,
  cluster,
  consumeMode,
  dlqCount,
  groupName,
  maxRetry,
  subscriptionsOf,
  type GroupSubscription,
} from "@/mq/rocketmq/subscriptions";

/** One row of the group's per-queue consume progress. */
interface QueueProgress {
  topic: string;
  brokerName: string;
  queueId: number;
  brokerOffset: number;
  consumerOffset: number;
  backlog: number;
  lastConsumed: number;
}

const R = { textAlign: "right" } as const;
const SORTS = ["backlog", "name"] as const;
type Sort = (typeof SORTS)[number];

const UNKNOWN = -1;

function metric(value: number): string {
  return value === UNKNOWN ? "—" : value.toLocaleString();
}

/**
 * Board 9a — RocketMQ consumer groups.
 *
 * The canvas's 延迟 column is gone: the brokers report a group's backlog and
 * its consume rate but no consume latency, and dividing one by the other would
 * be a guess dressed as a measurement. The dead-letter count, which they do
 * report, takes the column instead.
 *
 * The client table lost its assigned-queues and per-client backlog columns for
 * the same reason - the connection info a broker returns is the client id, its
 * address and its version, and nothing about what it was assigned.
 *
 * There is no create or edit here, and it is not an oversight: rocketmq-admin-go
 * sends a subscription group config in the request's extFields, while RocketMQ
 * 5.x decodes it from the request body, so every create and update is answered
 * with a NullPointerException from the broker. Listing and deleting take the
 * extFields route and work. See TestLiveConsumerGroupDelete.
 */
export function ConsumersRocketMQ() {
  const { t } = useTranslation();
  const { id: connID } = useConnectionScope();
  const { settings } = useSettings();
  const toast = useToast();
  const confirm = useConfirm();
  const [resetting, setResetting] = useState<string | null>(null);
  const [cloning, setCloning] = useState<string | null>(null);
  const [queueOffset, setQueueOffset] = useState<QueueTarget | undefined>();
  const lagThreshold = settings.lagAlertThreshold ?? 10000;

  const [backlogOnly, setBacklogOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("backlog");

  const load = useCallback((id: number) => consumerApi.getConsumerGroups(id), []);
  const state = useBrokerData(load);
  const groups = state.data ?? [];

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = groups.filter(
      (group) =>
        (!backlogOnly || (group.backlog ?? 0) > 0) &&
        (needle === "" || groupName(group).toLowerCase().includes(needle)),
    );
    return [...matched].sort((left, right) => {
      if (sort === "name") return groupName(left).localeCompare(groupName(right));
      return (right.backlog ?? 0) - (left.backlog ?? 0);
    });
  }, [backlogOnly, groups, query, sort]);

  const current = rows.find((group) => groupName(group) === selected);
  const resetOffset = async (topic: string, timestamp: number, force: boolean) => {
    if (resetting == null) return;
    await consumerApi.resetOffset(connID, resetting, topic, timestamp, force);
    toast.success(t("board.consumers.rocketmq.reset.done", { name: resetting }));
    await state.refresh();
  };

  const cloneOffset = async (to: string, destination: string, fromOffline: boolean) => {
    if (cloning == null) return;
    await consumerApi.cloneOffset(connID, cloning, to, destination, fromOffline);
    toast.success(t("board.consumers.rocketmq.clone.done", { from: cloning, to }));
    await state.refresh();
  };

  const setOneQueueOffset = async (target: QueueTarget, offset: number) => {
    if (selected == null) return;
    await consumerApi.setQueueOffset(
      connID, selected, target.topic, target.brokerName, target.queueId, offset,
    );
    toast.success(t("board.consumers.rocketmq.queueOffset.done", {
      queue: `${target.brokerName} q${target.queueId}`,
      offset: offset.toLocaleString(),
    }));
    await state.refresh();
  };

  const remove = async (group: Subscription) => {
    const name = groupName(group);
    const confirmed = await confirm({
      title: t("board.consumers.rocketmq.deleteTitle"),
      description: t("board.consumers.rocketmq.deleteDesc", { name }),
      confirmLabel: t("board.common.delete"),
      danger: true,
    });
    if (!confirmed) return;
    try {
      await consumerApi.deleteConsumerGroup(connID, name, "");
      toast.success(t("board.consumers.rocketmq.deleted", { name }));
      setSelected(null);
      await state.refresh();
    } catch (failure) {
      toast.error(t("board.consumers.rocketmq.deleteFailed"), {
        description: formatErrorMessage(failure),
      });
    }
  };

  return (
    <Page>
      <PageHeader
        title={t("board.common.consumerGroup")}
        subtitle={t("board.consumers.rocketmq.liveSubtitle", { count: groups.length })}
        actions={
          <Button variant="outline" disabled={state.refreshing || !state.online} onClick={() => void state.refresh()}>
            {state.refreshing && <RefreshCw size={12} className="mqs-turning" aria-hidden />}
            {t("board.common.refresh")}
          </Button>
        }
      />
      <Toolbar>
        <Input
          className="w-[220px] flex-none"
          placeholder={t("board.common.searchGroups")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <label className="flex items-center gap-1.5 text-xs text-(--c-mono-dim)">
          <Switch checked={backlogOnly} onCheckedChange={setBacklogOnly} />
          {t("board.consumers.rocketmq.backlogOnly")}
        </label>
        <span className="flex-1" />
        <SelectField
          value={sort}
          onValueChange={setSort}
          options={SORTS.map((key) => ({
            value: key,
            label: t(`board.consumers.rocketmq.sort.${key}`),
          }))}
        />
      </Toolbar>

      {isBlocked(state) ? (
        <BoardState state={state} />
      ) : (
        <ListArea>
          <ListPane>
            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("board.consumers.rocketmq.groupName")}</TableHead>
                  <TableHead style={R}>{t("board.consumers.rocketmq.subTopic")}</TableHead>
                  <TableHead>{t("board.common.mode")}</TableHead>
                  <TableHead style={R}>{t("board.common.client")}</TableHead>
                  <TableHead style={R}>{t("board.common.backlog")}</TableHead>
                  <TableHead style={R}>{t("board.consumers.rocketmq.dlq")}</TableHead>
                  <TableHead>{t("board.common.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((group) => {
                  const name = groupName(group);
                  const backlog = group.backlog ?? 0;
                  const offline = group.status === "offline";
                  const alerting = backlog > lagThreshold;
                  const dim = offline ? { color: "var(--c-muted)" } : undefined;
                  return (
                    <TableRow key={name} selected={selected === name} onClick={() => setSelected(name)}>
                      <TableCell style={dim}>
                        {offline ? name : <b style={{ fontWeight: 500 }}>{name}</b>}
                      </TableCell>
                      <TableCell className="mono3" style={{ ...R, ...dim }}>
                        {metric(group.destinations)}
                      </TableCell>
                      <TableCell style={dim}>
                        {t(
                          consumeMode(group) === ConsumeMode.Broadcasting
                            ? "board.consumers.rocketmq.broadcast"
                            : "board.common.cluster",
                        )}
                      </TableCell>
                      <TableCell className="mono3" style={{ ...R, ...dim }}>
                        {metric(group.members)}
                      </TableCell>
                      <TableCell
                        className="mono3"
                        style={{ ...R, ...dim, ...(alerting ? { color: "var(--c-warn-text)" } : {}) }}
                      >
                        {metric(backlog)}
                      </TableCell>
                      <TableCell
                        className="mono3"
                        style={{ ...R, ...dim, ...(dlqCount(group) > 0 ? { color: "var(--c-err-text)" } : {}) }}
                      >
                        {dlqCount(group).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Status tone={offline ? "off" : alerting ? "warn" : "ok"}>
                          {t(
                            offline
                              ? "board.consumers.rocketmq.noClients"
                              : alerting
                                ? "board.common.backlogAlert"
                                : "board.common.healthy",
                          )}
                        </Status>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} style={{ padding: "34px", textAlign: "center", color: "var(--c-muted)" }}>
                      {t(groups.length === 0 ? "board.consumers.rocketmq.noGroups" : "board.common.noMatch")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ListPane>

          {current != null && (
            <GroupSheet
              group={current}
              lagThreshold={lagThreshold}
              onResetOffset={() => setResetting(groupName(current))}
              onCloneOffset={() => setCloning(groupName(current))}
              onSetQueueOffset={setQueueOffset}
              onDelete={() => void remove(current)}
              onClose={() => setSelected(null)}
            />
          )}
        </ListArea>
      )}

      <ResetOffsetDialog
        open={resetting != null}
        group={groups.find((group) => groupName(group) === resetting)}
        onClose={() => setResetting(null)}
        onSubmit={resetOffset}
      />
      <QueueOffsetDialog
        open={queueOffset != null}
        group={selected ?? ""}
        target={queueOffset}
        onClose={() => setQueueOffset(undefined)}
        onSubmit={setOneQueueOffset}
      />
      <CloneOffsetDialog
        open={cloning != null}
        source={groups.find((group) => groupName(group) === cloning)}
        groups={groups}
        onClose={() => setCloning(null)}
        onSubmit={cloneOffset}
      />
    </Page>
  );
}

/** One subscribed topic: its filter, and the group's progress on its queues. */
interface TopicBlock {
  topic: string;
  expression: string;
  backlog: number;
  queues: QueueProgress[];
}

/*
 * The subscription list and the per-queue progress are both keyed by topic, so
 * they are shown grouped rather than as two lists repeating the same names.
 *
 * A topic that only the progress mentions still gets a group: the subscription
 * table comes from the broker's connection info, which is empty for a group
 * with nobody connected, while its offsets outlive every client.
 */
function topicBlocks(
  subscriptions: GroupSubscription[],
  queues: QueueProgress[],
): TopicBlock[] {
  const blocks = new Map<string, TopicBlock>();
  for (const one of subscriptions) {
    blocks.set(one.topic, {
      topic: one.topic,
      expression: one.expression || "*",
      backlog: 0,
      queues: [],
    });
  }
  for (const queue of queues) {
    let block = blocks.get(queue.topic);
    if (block == null) {
      block = { topic: queue.topic, expression: "", backlog: 0, queues: [] };
      blocks.set(queue.topic, block);
    }
    block.queues.push(queue);
    block.backlog += Math.max(0, queue.backlog);
  }
  return [...blocks.values()];
}

/**
 * The consumer group inspector: one scrolling column, no tabs.
 *
 * Members come first because a group has one or two of them and dozens of
 * queues, so the long block is the one you scroll into rather than past.
 *
 * The consume TPS is read from the consume stats rather than off the group:
 * the group list has no TPS field to fill, so `rateOut` is unknown on every
 * row, while the stats call the queue table needs reports the real figure.
 */
function GroupSheet({
  group,
  lagThreshold,
  onResetOffset,
  onCloneOffset,
  onSetQueueOffset,
  onDelete,
  onClose,
}: {
  group: Subscription;
  lagThreshold: number;
  onResetOffset: () => void;
  onCloneOffset: () => void;
  onSetQueueOffset: (queue: QueueProgress) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const name = groupName(group);
  const backlog = group.backlog ?? 0;
  const offline = group.status === "offline";
  const alerting = backlog > lagThreshold;
  const clients = clientsOf(group);
  const runtimeBlocked = useCapabilities().degradedReason(Capability.CapSubscriptionRuntime);

  // One request per group, now paid on open: the queue progress no longer has
  // a tab to hide behind, and the group's consume TPS comes back with it.
  const loadStats = useCallback(
    (id: number) => consumerApi.getConsumeStats(id, name),
    [name],
  );
  const stats = useBrokerData(loadStats, { refreshMs: null });
  const queues = (stats.data?.["queues"] as QueueProgress[] | undefined) ?? [];
  const consumeTps = stats.data?.["consumeTps"] as number | undefined;
  const blocks = topicBlocks(subscriptionsOf(group), queues);

  return (
    <DetailPanel width={460} onDismiss={onClose}>
      <DetailPanelHeader
        title={name}
        badge={
          <Status tone={offline ? "off" : alerting ? "warn" : "ok"} style={{ fontSize: "10px" }}>
            {t(
              offline
                ? "board.consumers.rocketmq.noClients"
                : alerting
                  ? "board.common.backlogAlert"
                  : "board.common.healthy",
            )}
          </Status>
        }
        onClose={onClose}
      />
      <DetailPanelBody>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
          <MiniStat
            label={t("board.common.backlog")}
            value={backlog.toLocaleString()}
            color={alerting ? "var(--c-warn-text)" : undefined}
          />
          <MiniStat
            label={t("board.common.consumeTps")}
            value={consumeTps == null ? "—" : consumeTps.toLocaleString()}
          />
          <MiniStat label={t("board.common.client")} value={metric(group.members)} />
        </div>

        <KV
          rows={[
            [
              t("board.common.mode"),
              t(
                consumeMode(group) === ConsumeMode.Broadcasting
                  ? "board.consumers.rocketmq.broadcast"
                  : "board.common.cluster",
              ),
            ],
            [t("board.consumers.rocketmq.retryPolicy"), String(maxRetry(group))],
            [t("board.consumers.rocketmq.dlq"), dlqCount(group).toLocaleString()],
            [t("board.common.cluster"), cluster(group) || "—"],
          ]}
        />

        <div>
          <SectionLabel className="mb-1.5">{t("board.common.members")}</SectionLabel>
          {clients.length === 0 ? (
            <Notice title={t("board.consumers.rocketmq.noClients")} />
          ) : (
            <Panel style={{ overflow: "hidden" }}>
              <Table className="text-xs [&_td]:px-2.5 [&_th]:px-2.5">
                <TableHeader>
                  <TableRow>
                    <TableHead>ClientId</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead style={R}>{t("board.consumers.rocketmq.version")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clients.map((client) => (
                    <TableRow key={client.clientId}>
                      <TableCell className="mono3">{client.clientId}</TableCell>
                      <TableCell className="mono3" style={{ color: "var(--c-mono-dim)" }}>
                        {client.ip}
                      </TableCell>
                      <TableCell className="mono3" style={R}>
                        {client.version}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Panel>
          )}
          {/* Which queues each client holds is what this table wants next, and
              the endpoint says why it cannot answer. Silence would read as
              RocketMQ having no such concept. */}
          {runtimeBlocked != null && (
            <p className="m-0 mt-1.5 text-xs leading-relaxed text-(--c-muted)">
              {t("board.consumers.rocketmq.runtimeBlocked")}
              <span className="mt-0.5 block text-(--c-muted-2)">{runtimeBlocked}</span>
            </p>
          )}
        </div>

        <div>
          <SectionLabel
            className="mb-1.5"
            actionColor="inherit"
            action={stats.loading ? <Spinner className="size-3" /> : null}
          >
            {t("board.consumers.rocketmq.subProgress")}
          </SectionLabel>

          {blocks.length === 0 ? (
            <Notice title={t("board.consumers.rocketmq.noSubs")} />
          ) : (
            <Panel style={{ overflow: "hidden" }}>
              <Table className="text-xs [&_td]:px-2.5 [&_th]:px-2.5">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("board.common.queue")}</TableHead>
                    <TableHead style={R}>{t("board.consumers.rocketmq.position")}</TableHead>
                    <TableHead style={R}>{t("board.common.backlog")}</TableHead>
                    <TableHead style={R}>{t("board.common.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {blocks.map((block) => (
                    <Fragment key={block.topic}>
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableCell colSpan={2} className="py-1.5">
                          <span className="flex items-center gap-1.5">
                            <b className="mono3 font-medium">{block.topic}</b>
                            {block.expression !== "" && (
                              <span className="text-(--c-muted)">
                                {t("board.consumers.rocketmq.expression")}{" "}
                                <span className="mono3 text-(--c-mono-dim)">{block.expression}</span>
                              </span>
                            )}
                          </span>
                        </TableCell>
                        <TableCell
                          className="mono3 py-1.5"
                          style={{ ...R, ...(block.backlog > 0 ? { color: "var(--c-warn-text)" } : {}) }}
                        >
                          {block.backlog.toLocaleString()}
                        </TableCell>
                        <TableCell />
                      </TableRow>
                      {block.queues.map((queue) => (
                        <TableRow key={`${queue.brokerName}-${queue.queueId}`}>
                          <TableCell className="mono3" style={{ paddingLeft: "20px" }}>
                            {queue.brokerName} q{queue.queueId}
                          </TableCell>
                          <TableCell className="mono3" style={{ ...R, color: "var(--c-mono-dim)" }}>
                            {queue.consumerOffset.toLocaleString()} /{" "}
                            {queue.brokerOffset.toLocaleString()}
                            {/* When the queue last moved, which is the
                                difference between a slow consumer and a
                                stuck one once the backlog is non-zero. */}
                            <span className="mt-0.5 block text-[10.5px] text-(--c-muted)">
                              {t("board.consumers.rocketmq.lastConsumed")}{" "}
                              {formatMessageTime(
                                queue.lastConsumed,
                                settings.timezone,
                                settings.timestampFormat,
                              )}
                            </span>
                          </TableCell>
                          <TableCell
                            className="mono3"
                            style={{ ...R, ...(queue.backlog > 0 ? { color: "var(--c-warn-text)" } : {}) }}
                          >
                            {Math.max(0, queue.backlog).toLocaleString()}
                          </TableCell>
                          <TableCell style={R}>
                            <Button variant="ghost" size="xs" onClick={() => onSetQueueOffset(queue)}>
                              {t("board.consumers.rocketmq.queueOffset.action")}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      {block.queues.length === 0 && stats.data != null && (
                        <TableRow>
                          <TableCell
                            colSpan={4}
                            style={{ textAlign: "center", color: "var(--c-muted)" }}
                          >
                            {t("board.consumers.rocketmq.noQueues")}
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </Panel>
          )}

          {stats.error != null && <BoardState state={stats} />}
        </div>
      </DetailPanelBody>
      <DetailPanelFooter>
        <Button variant="outline" onClick={onResetOffset}>{t("board.common.resetOffset")}</Button>
        <Button variant="outline" onClick={onCloneOffset}>
          {t("board.consumers.rocketmq.clone.action")}
        </Button>
        <span className="flex-1" />
        <Button variant="destructive" onClick={onDelete}>
          {t("board.common.deleteGroup")}
        </Button>
      </DetailPanelFooter>
    </DetailPanel>
  );
}
