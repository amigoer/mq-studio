import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { ListArea, ListPane, Page, PageHeader, Toolbar } from "@/design/shell";
import {
  Btn,
  Card,
  Field,
  KV,
  Menu,
  MenuItem,
  MiniStat,
  MiniTable,
  SectionLabel,
  SelectField,
  Sheet,
  SheetBody,
  SheetHeader,
  Status,
  Sw,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/design/ui";
import { BoardState, Notice, isBlocked } from "@/design/boards/BoardState";
import { useBrokerData } from "@/hooks/useBrokerData";
import { useSettings } from "@/hooks/useSettings";
import * as consumerApi from "@/api/consumer";
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
 */
export function ConsumersRocketMQ() {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const lagThreshold = settings.lagAlertThreshold ?? 10000;

  const [backlogOnly, setBacklogOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>(SHEET_TABS[0]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("backlog");
  const [sortOpen, setSortOpen] = useState(false);

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

  return (
    <Page>
      <PageHeader
        title={t("board.common.consumerGroup")}
        subtitle={t("board.consumers.rocketmq.liveSubtitle", { count: groups.length })}
        actions={
          <Btn disabled={state.refreshing || !state.online} onClick={() => void state.refresh()}>
            {state.refreshing && <RefreshCw size={12} className="mqs-turning" aria-hidden />}
            {t("board.common.refresh")}
          </Btn>
        }
      />
      <Toolbar>
        <Field
          style={{ flex: "0 0 220px" }}
          placeholder={t("board.common.searchGroups")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "var(--c-mono-dim)" }}>
          <Sw checked={backlogOnly} onCheckedChange={setBacklogOnly} label={t("board.consumers.rocketmq.backlogOnly")} />
          {t("board.consumers.rocketmq.backlogOnly")}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ position: "relative" }}>
          <SelectField
            value={t(`board.consumers.rocketmq.sort.${sort}`)}
            onClick={() => setSortOpen((open) => !open)}
          />
          <Menu open={sortOpen} onClose={() => setSortOpen(false)}>
            {SORTS.map((key) => (
              <MenuItem
                key={key}
                onSelect={() => {
                  setSort(key);
                  setSortOpen(false);
                }}
              >
                {t(`board.consumers.rocketmq.sort.${key}`)}
              </MenuItem>
            ))}
          </Menu>
        </span>
      </Toolbar>

      {isBlocked(state) ? (
        <BoardState state={state} />
      ) : (
        <ListArea>
          <ListPane>
            <Table className="inset">
              <THead>
                <TR>
                  <TH>{t("board.consumers.rocketmq.groupName")}</TH>
                  <TH style={R}>{t("board.consumers.rocketmq.subTopic")}</TH>
                  <TH>{t("board.common.mode")}</TH>
                  <TH style={R}>{t("board.common.client")}</TH>
                  <TH style={R}>{t("board.common.consumeTps")}</TH>
                  <TH style={R}>{t("board.common.backlog")}</TH>
                  <TH style={R}>{t("board.consumers.rocketmq.dlq")}</TH>
                  <TH>{t("board.common.status")}</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((group) => {
                  const name = groupName(group);
                  const backlog = group.backlog ?? 0;
                  const offline = group.status === "offline";
                  const alerting = backlog > lagThreshold;
                  const dim = offline ? { color: "var(--c-muted)" } : undefined;
                  return (
                    <TR key={name} selected={selected === name} onClick={() => setSelected(name)}>
                      <TD style={dim}>
                        {offline ? name : <b style={{ fontWeight: 500 }}>{name}</b>}
                      </TD>
                      <TD className="mono3" style={{ ...R, ...dim }}>
                        {metric(group.destinations)}
                      </TD>
                      <TD style={dim}>
                        {t(
                          consumeMode(group) === ConsumeMode.Broadcasting
                            ? "board.consumers.rocketmq.broadcast"
                            : "board.common.cluster",
                        )}
                      </TD>
                      <TD className="mono3" style={{ ...R, ...dim }}>
                        {metric(group.members)}
                      </TD>
                      <TD className="mono3" style={{ ...R, ...dim }}>
                        {metric(group.rateOut)}
                      </TD>
                      <TD
                        className="mono3"
                        style={{ ...R, ...dim, ...(alerting ? { color: "var(--c-warn-text)" } : {}) }}
                      >
                        {metric(backlog)}
                      </TD>
                      <TD
                        className="mono3"
                        style={{ ...R, ...dim, ...(dlqCount(group) > 0 ? { color: "var(--c-err-text)" } : {}) }}
                      >
                        {dlqCount(group).toLocaleString()}
                      </TD>
                      <TD>
                        <Status tone={offline ? "off" : alerting ? "warn" : "ok"}>
                          {t(
                            offline
                              ? "board.consumers.rocketmq.noClients"
                              : alerting
                                ? "board.common.backlogAlert"
                                : "board.common.healthy",
                          )}
                        </Status>
                      </TD>
                    </TR>
                  );
                })}
                {rows.length === 0 && (
                  <TR>
                    <TD colSpan={8} style={{ padding: "34px", textAlign: "center", color: "var(--c-muted)" }}>
                      {t(groups.length === 0 ? "board.consumers.rocketmq.noGroups" : "board.common.noMatch")}
                    </TD>
                  </TR>
                )}
              </TBody>
            </Table>
          </ListPane>

          {current != null && (
            <GroupSheet
              group={current}
              lagThreshold={lagThreshold}
              tab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
          )}
        </ListArea>
      )}
    </Page>
  );
}

function GroupSheet({
  group,
  lagThreshold,
  tab,
  onTabChange,
  onClose,
}: {
  group: Subscription;
  lagThreshold: number;
  tab: string;
  onTabChange: (tab: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const backlog = group.backlog ?? 0;
  const alerting = backlog > lagThreshold;
  const clients = clientsOf(group);
  const subscriptions = subscriptionsOf(group);

  return (
    <Sheet width={390} onDismiss={onClose}>
      <SheetHeader
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
      <SheetBody>
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
            <Card style={{ overflow: "hidden" }}>
              <MiniTable>
                <THead>
                  <TR>
                    <TH>Topic</TH>
                    <TH>{t("board.consumers.rocketmq.expression")}</TH>
                  </TR>
                </THead>
                <TBody>
                  {subscriptions.map((one) => (
                    <TR key={one.topic}>
                      <TD className="mono3">{one.topic}</TD>
                      <TD className="mono3" style={{ color: "var(--c-mono-dim)" }}>
                        {one.expression || "*"}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </MiniTable>
            </Card>
          )}
        </div>

        <div>
          <SectionLabel style={{ marginBottom: "6px" }}>{t("board.consumers.rocketmq.onlineClients")}</SectionLabel>
          {clients.length === 0 ? (
            <Notice title={t("board.consumers.rocketmq.noClients")} />
          ) : (
            <Card style={{ overflow: "hidden" }}>
              <MiniTable>
                <THead>
                  <TR>
                    <TH>ClientId</TH>
                    <TH>IP</TH>
                    <TH style={R}>{t("board.consumers.rocketmq.version")}</TH>
                  </TR>
                </THead>
                <TBody>
                  {clients.map((client) => (
                    <TR key={client.clientId}>
                      <TD className="mono3">{client.clientId}</TD>
                      <TD className="mono3" style={{ color: "var(--c-mono-dim)" }}>
                        {client.ip}
                      </TD>
                      <TD className="mono3" style={R}>
                        {client.version}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </MiniTable>
            </Card>
          )}
        </div>
      </SheetBody>
    </Sheet>
  );
}
