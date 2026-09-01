import { Fragment, useCallback, useMemo, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ListArea, ListPane, Page, PageHeader, RefreshButton, Toolbar } from "@/design/shell";
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
import { SubscriptionStatus } from "@bindings/model/models";
import type { SubscriptionClient } from "@bindings/model/models";
import { CloneOffsetDialog } from "./CloneOffsetDialog";
import { ConsumerGroupDialog, type ConsumerGroupForm } from "./ConsumerGroupDialog";
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

/** A group nobody could be asked about: the broker did not answer for it. */
function statusUnknown(group: Subscription): boolean {
  return group.status === SubscriptionStatus.SubscriptionWarning;
}

function modeText(group: Subscription, t: TFunction): string {
  const mode = consumeMode(group);
  if (mode == null) return "—";
  return t(
    mode === ConsumeMode.Broadcasting
      ? "board.consumers.rocketmq.broadcast"
      : "board.common.cluster",
  );
}

/**
 * The chip the row and the panel header both carry.
 *
 * Offline and unknown are separate answers - the broker said nobody is
 * attached, versus it did not answer at all - and collapsing them is what let
 * a group with no consumers show a healthy badge.
 */
function GroupStatus({
  group,
  alerting,
  style,
}: {
  group: Subscription;
  alerting: boolean;
  style?: CSSProperties;
}) {
  const { t } = useTranslation();
  const [tone, key] =
    group.status === SubscriptionStatus.SubscriptionOffline
      ? (["off", "board.consumers.rocketmq.noClients"] as const)
      : statusUnknown(group)
        ? (["warn", "board.consumers.rocketmq.clientsUnknown"] as const)
        : alerting
          ? (["warn", "board.common.backlogAlert"] as const)
          : (["ok", "board.common.healthy"] as const);
  return (
    <Status tone={tone} style={style}>
      {t(key)}
    </Status>
  );
}

/**
 * Board 9a — RocketMQ consumer groups.
 *
 * The canvas's 延迟 column is gone: the brokers report a group's backlog and
 * its consume rate but no consume latency, and dividing one by the other would
 * be a guess dressed as a measurement. The dead-letter count, which they do
 * report, takes the column instead.
 *
 * The client table's queue count and its per-client breakdown do not come with
 * the group: the connection info a broker returns is the client id, its address
 * and its version, so what each one holds is a second call, paid on open.
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
  /* null editing means "create"; the whole state being null means closed,
     which is how the topic board tells the two apart as well. */
  const [dialog, setDialog] = useState<{ editing: string | null } | null>(null);
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

  const submit = async (form: ConsumerGroupForm) => {
    const write = dialog?.editing != null
      ? consumerApi.updateConsumerGroup
      : consumerApi.createConsumerGroup;
    await write(connID, form.group, form.brokerAddr, form.consumeMode, form.maxRetry);
    toast.success(t("board.consumers.rocketmq.form.saved", { name: form.group }));
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
          <>
            <RefreshButton
              refreshing={state.refreshing}
              online={state.online}
              onClick={() => void state.refresh()}
            />
            <Button disabled={!state.online} onClick={() => setDialog({ editing: null })}>
              {t("board.consumers.rocketmq.form.newAction")}
            </Button>
          </>
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
                  const offline = group.status === SubscriptionStatus.SubscriptionOffline;
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
                      <TableCell style={dim}>{modeText(group, t)}</TableCell>
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
                        <GroupStatus group={group} alerting={alerting} />
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
              onEdit={() => setDialog({ editing: groupName(current) })}
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
      <ConsumerGroupDialog
        open={dialog != null}
        editing={
          dialog?.editing != null
            ? groups.find((group) => groupName(group) === dialog.editing)
            : undefined
        }
        onClose={() => setDialog(null)}
        onSubmit={submit}
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

/** One node's queues, as one line of the client breakdown. */
interface ClientNode {
  name: string;
  queues: number[];
}

/** One topic a client reads, with the queues it holds and its rates on them. */
interface ClientTopic {
  name: string;
  rated: boolean;
  pullRate: number;
  consumeRate: number;
  latencyMs: number;
  failed: number;
  pending: number;
  nodes: ClientNode[];
  /* Queues the client is handing back in a rebalance. Kept apart from the ones
     it holds rather than marked, because "still listed" and "still being
     consumed" are what a reader is here to tell apart. */
  releasing: ClientNode[];
}

/*
 * A client reports its queues and its rates in two separate tables, keyed by
 * message queue and by topic. Both are folded onto the topic here: which
 * queues a client holds and how fast it is getting through them is one answer,
 * and a client that has been rebalanced off a topic still reports rates for it.
 */
function clientTopics(client: SubscriptionClient): ClientTopic[] {
  const topics = new Map<string, ClientTopic>();
  const topicOf = (name: string): ClientTopic => {
    let topic = topics.get(name);
    if (topic == null) {
      topic = {
        name,
        rated: false,
        pullRate: 0,
        consumeRate: 0,
        latencyMs: 0,
        failed: 0,
        pending: 0,
        nodes: [],
        releasing: [],
      };
      topics.set(name, topic);
    }
    return topic;
  };

  const nodeOf = (nodes: ClientNode[], name: string): ClientNode => {
    let node = nodes.find((candidate) => candidate.name === name);
    if (node == null) {
      node = { name, queues: [] };
      nodes.push(node);
    }
    return node;
  };

  for (const assignment of client.assignments) {
    const topic = topicOf(assignment.destination);
    topic.pending += assignment.pending;
    const into = assignment.dropped ? topic.releasing : topic.nodes;
    nodeOf(into, assignment.node).queues.push(assignment.queueId);
  }

  for (const throughput of client.throughput) {
    const topic = topicOf(throughput.destination);
    topic.rated = true;
    topic.pullRate = throughput.pullRate;
    topic.consumeRate = throughput.successRate;
    topic.latencyMs = throughput.consumeLatencyMs;
    topic.failed = throughput.failedMessages;
  }

  return [...topics.values()];
}

/** A rate with enough digits to read, and no more. */
function perSecond(value: number): string {
  if (value >= 100) return `${Math.round(value).toLocaleString()}/s`;
  return `${value.toFixed(value >= 10 ? 1 : 2)}/s`;
}

function millis(value: number): string {
  return `${value >= 10 ? Math.round(value).toLocaleString() : value.toFixed(2)} ms`;
}

/** One node's held queues as `broker-a q0 q1 q2`. */
function queueLine(nodes: ClientNode[]): string {
  return nodes
    .map((node) => `${node.name} ${node.queues.map((queue) => `q${queue}`).join(" ")}`)
    .join("  ");
}

/**
 * What one consumer client is doing, grouped by the topic it reads.
 *
 * The queues are listed as ids rather than rows: a client can hold dozens, and
 * their offsets are already in the group's own progress table below. What this
 * adds is which client holds which, and how fast that one is getting through
 * them - the pair that says whether a backlog is a slow consumer or an unfair
 * split.
 */
function ClientRuntime({ client }: { client: SubscriptionClient | undefined }) {
  const { t } = useTranslation();
  const topics = client == null ? [] : clientTopics(client);
  if (topics.length === 0) {
    return <span className="text-(--c-muted)">{t("board.consumers.rocketmq.clientSilent")}</span>;
  }
  return (
    <div className="flex flex-col gap-2">
      {topics.map((topic) => (
        <div key={topic.name}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <b className="mono3 font-medium">{topic.name}</b>
            <span className="text-[10.5px] text-(--c-muted)">
              {topic.rated
                ? `${t("board.consumers.rocketmq.pullRate")} ${perSecond(topic.pullRate)} · ` +
                  `${t("board.consumers.rocketmq.consumeRate")} ${perSecond(topic.consumeRate)} · ` +
                  `${t("board.consumers.rocketmq.consumeLatency")} ${millis(topic.latencyMs)}`
                : "—"}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-2">
            <span className="mono3 text-(--c-mono-dim)">{queueLine(topic.nodes) || "—"}</span>
            {(topic.pending > 0 || topic.failed > 0) && (
              <span className="text-[10.5px] text-(--c-warn-text)">
                {topic.pending > 0 &&
                  `${t("board.consumers.rocketmq.buffered")} ${topic.pending.toLocaleString()}`}
                {topic.pending > 0 && topic.failed > 0 && " · "}
                {topic.failed > 0 &&
                  `${t("board.consumers.rocketmq.failed")} ${topic.failed.toLocaleString()}`}
              </span>
            )}
          </div>
          {topic.releasing.length > 0 && (
            <div className="mono3 mt-0.5 text-(--c-warn-text)">
              {t("board.consumers.rocketmq.releasing")} {queueLine(topic.releasing)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
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
  onEdit,
  onDelete,
  onClose,
}: {
  group: Subscription;
  lagThreshold: number;
  onResetOffset: () => void;
  onCloneOffset: () => void;
  onSetQueueOffset: (queue: QueueProgress) => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const name = groupName(group);
  const backlog = group.backlog ?? 0;
  const alerting = backlog > lagThreshold;
  const clients = clientsOf(group);
  const [openClient, setOpenClient] = useState<string | null>(null);

  /* What each client holds comes from the clients themselves, one round trip
     each, so it is asked for when a group is opened rather than with the list.
     The group's own queue progress is a separate call and a separate table:
     that one is the broker's view of where the group is, this one is who is
     carrying which part of it. */
  const loadClients = useCallback(
    (id: number) => consumerApi.getConsumerClients(id, name),
    [name],
  );
  // A group with nobody attached has nothing to ask, and the driver answers
  // that with an error rather than an empty list.
  const runtime = useBrokerData(loadClients, {
    refreshMs: null,
    enabled: clients.length > 0,
  });
  const held = useMemo(() => {
    const byClient = new Map<string, SubscriptionClient>();
    for (const client of runtime.data ?? []) byClient.set(client.clientId, client);
    return byClient;
  }, [runtime.data]);

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
    <DetailPanel width={500} onDismiss={onClose}>
      <DetailPanelHeader
        title={name}
        badge={<GroupStatus group={group} alerting={alerting} style={{ fontSize: "10px" }} />}
        onClose={onClose}
      />
      <DetailPanelBody>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
          <MiniStat
            label={t("board.common.backlog")}
            value={metric(backlog)}
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
            [t("board.common.mode"), modeText(group, t)],
            [t("board.consumers.rocketmq.retryPolicy"), String(maxRetry(group))],
            [t("board.consumers.rocketmq.dlq"), dlqCount(group).toLocaleString()],
            [t("board.common.cluster"), cluster(group) || "—"],
          ]}
        />

        <div>
          <SectionLabel
            className="mb-1.5"
            actionColor="inherit"
            action={runtime.loading && clients.length > 0 ? <Spinner className="size-3" /> : null}
          >
            {t("board.common.members")}
          </SectionLabel>
          {clients.length === 0 ? (
            <Notice
              title={t(
                statusUnknown(group)
                  ? "board.consumers.rocketmq.clientsUnknown"
                  : "board.consumers.rocketmq.noClients",
              )}
            >
              {statusUnknown(group) ? t("board.consumers.rocketmq.clientsUnknownHint") : null}
            </Notice>
          ) : (
            <Panel style={{ overflow: "hidden" }}>
              <Table className="text-xs [&_td]:px-2.5 [&_th]:px-2.5">
                <TableHeader>
                  <TableRow>
                    <TableHead>ClientId</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead style={R}>{t("board.consumers.rocketmq.version")}</TableHead>
                    <TableHead style={R}>{t("board.consumers.rocketmq.held")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clients.map((client) => {
                    const runtimeClient = held.get(client.clientId);
                    const open = openClient === client.clientId;
                    return (
                      <Fragment key={client.clientId}>
                        <TableRow
                          className="cursor-pointer"
                          onClick={() => setOpenClient(open ? null : client.clientId)}
                        >
                          <TableCell className="mono3">{client.clientId}</TableCell>
                          <TableCell className="mono3" style={{ color: "var(--c-mono-dim)" }}>
                            {client.ip}
                          </TableCell>
                          <TableCell className="mono3" style={R}>
                            {client.version}
                          </TableCell>
                          <TableCell className="mono3" style={R}>
                            {runtimeClient == null
                              ? "—"
                              : runtimeClient.assignments.length.toLocaleString()}
                          </TableCell>
                        </TableRow>
                        {open && (
                          <TableRow className="bg-muted/40 hover:bg-muted/40">
                            <TableCell colSpan={4} className="py-2">
                              {runtime.loading ? (
                                <Spinner className="size-3" />
                              ) : (
                                <ClientRuntime client={runtimeClient} />
                              )}
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </Panel>
          )}
          {runtime.error != null && clients.length > 0 && <BoardState state={runtime} />}
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
                    {/* The last-consumed label belongs here, not on every row:
                        repeated per queue it cost more width than the
                        timestamps it introduced, and pushed the table into a
                        horizontal scroll inside a panel this narrow. */}
                    <TableHead style={R}>
                      {t("board.consumers.rocketmq.position")}
                      <span className="mt-0.5 block text-[10.5px] font-normal">
                        {t("board.consumers.rocketmq.lastConsumed")}
                      </span>
                    </TableHead>
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
        <Button variant="outline" onClick={onEdit}>
          {t("board.common.edit")}
        </Button>
        <span className="flex-1" />
        <Button variant="destructive" onClick={onDelete}>
          {t("board.common.deleteGroup")}
        </Button>
      </DetailPanelFooter>
    </DetailPanel>
  );
}
