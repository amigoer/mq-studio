import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { ListArea, ListPane, Page, PageHeader, Toolbar } from "@/design/shell";
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
import { ResetOffsetDialog } from "./ResetOffsetDialog";
import * as consumerApi from "@/api/consumer";
import { formatErrorMessage } from "@/lib/utils";
import type { Subscription } from "@/api/models";
import {
  ConsumeMode,
  clientsOf,
  consumeMode,
  dlqCount,
  groupName,
  maxRetry,
  subscriptionsOf,
} from "@/mq/rocketmq/subscriptions";

const SHEET_TABS = [
  "board.common.overview",
  "board.common.members",
  "board.consumers.rocketmq.subRel",
] as const;
const R = { textAlign: "right" } as const;
const SORTS = ["backlog", "name", "consume"] as const;
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
  const lagThreshold = settings.lagAlertThreshold ?? 10000;

  const [backlogOnly, setBacklogOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>(SHEET_TABS[0]);
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
      if (sort === "consume") return right.rateOut - left.rateOut;
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
                  <TableHead style={R}>{t("board.common.consumeTps")}</TableHead>
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
                      <TableCell className="mono3" style={{ ...R, ...dim }}>
                        {metric(group.rateOut)}
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
                    <TableCell colSpan={8} style={{ padding: "34px", textAlign: "center", color: "var(--c-muted)" }}>
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
              tab={tab}
              onTabChange={setTab}
              onResetOffset={() => setResetting(groupName(current))}
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
    </Page>
  );
}

function GroupSheet({
  group,
  lagThreshold,
  tab,
  onTabChange,
  onResetOffset,
  onDelete,
  onClose,
}: {
  group: Subscription;
  lagThreshold: number;
  tab: string;
  onTabChange: (tab: string) => void;
  onResetOffset: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const backlog = group.backlog ?? 0;
  const alerting = backlog > lagThreshold;
  const clients = clientsOf(group);
  const subscriptions = subscriptionsOf(group);

  return (
    <DetailPanel width={390} onDismiss={onClose}>
      <DetailPanelHeader
        title={groupName(group)}
        badge={
          <Status tone={alerting ? "warn" : "ok"} style={{ fontSize: "10px" }}>
            {t("board.common.backlog")} {backlog.toLocaleString()}
          </Status>
        }
        tabs={SHEET_TABS.map((id) => ({ id, label: t(id) }))}
        activeTab={tab}
        onTabChange={onTabChange}
        onClose={onClose}
      />
      <DetailPanelBody>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
          <MiniStat
            label={t("board.common.backlog")}
            value={backlog.toLocaleString()}
            color={alerting ? "var(--c-warn-text)" : undefined}
          />
          <MiniStat label={t("board.common.consumeTps")} value={metric(group.rateOut)} />
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
          ]}
        />

        <div>
          <SectionLabel style={{ marginBottom: "6px" }}>{t("board.consumers.rocketmq.subRel")}</SectionLabel>
          {subscriptions.length === 0 ? (
            <Notice title={t("board.consumers.rocketmq.noSubs")} />
          ) : (
            <Panel style={{ overflow: "hidden" }}>
              <Table className="text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead>Topic</TableHead>
                    <TableHead>{t("board.consumers.rocketmq.expression")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subscriptions.map((one) => (
                    <TableRow key={one.topic}>
                      <TableCell className="mono3">{one.topic}</TableCell>
                      <TableCell className="mono3" style={{ color: "var(--c-mono-dim)" }}>
                        {one.expression || "*"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Panel>
          )}
        </div>

        <div>
          <SectionLabel style={{ marginBottom: "6px" }}>{t("board.consumers.rocketmq.onlineClients")}</SectionLabel>
          {clients.length === 0 ? (
            <Notice title={t("board.consumers.rocketmq.noClients")} />
          ) : (
            <Panel style={{ overflow: "hidden" }}>
              <Table className="text-xs">
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
        </div>
      </DetailPanelBody>
      <DetailPanelFooter>
        <Button variant="outline" onClick={onResetOffset}>{t("board.common.resetOffset")}</Button>
        <span className="flex-1" />
        <Button variant="destructive" onClick={onDelete}>
          {t("board.common.deleteGroup")}
        </Button>
      </DetailPanelFooter>
    </DetailPanel>
  );
}
