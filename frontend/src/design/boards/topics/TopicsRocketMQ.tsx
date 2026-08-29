import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { ListArea, ListPane, Page, PageHeader, Toolbar } from "@/design/shell";
import {
  Btn,
  Card,
  Field,
  KV,
  MiniTable,
  ProtoBadge,
  SectionLabel,
  SelectField,
  Menu,
  MenuItem,
  Sheet,
  SheetBody,
  SheetFooter,
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
import * as topicApi from "@/api/topic";
import type { Destination } from "@/api/models";
import {
  UNKNOWN_METRIC,
  consumerGroups,
  messageType,
  perm,
  readQueue,
  routes,
  topicName,
  writeQueue,
} from "@/mq/rocketmq/destinations";

const SHEET_TABS = ["board.common.overview", "board.common.queue", "board.topics.rocketmq.route"] as const;

const SORTS = ["backlog", "name", "produce"] as const;
type Sort = (typeof SORTS)[number];

function metric(value: number): string {
  return value === UNKNOWN_METRIC ? "—" : value.toLocaleString();
}

/** RocketMQ's own internal topics, which the toggle hides by default. */
function isInternal(name: string): boolean {
  return name.startsWith("%RETRY%") || name.startsWith("%DLQ%");
}

/**
 * Board 3c — RocketMQ topics. The detail panel is a floating sheet rather than
 * a third column, so opening it never reflows the table's column widths.
 *
 * The canvas's "今日消息量" column is gone: the brokers report a per-topic
 * message count for today nowhere, only per broker, and a topic-level figure
 * would have to be invented. Created-at went the same way.
 */
export function TopicsRocketMQ() {
  const { t } = useTranslation();
  const [showSystem, setShowSystem] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>(SHEET_TABS[0]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("backlog");
  const [sortOpen, setSortOpen] = useState(false);

  const load = useCallback(
    (id: number) => (showSystem ? topicApi.getAllTopics(id) : topicApi.getTopics(id)),
    [showSystem],
  );
  const state = useBrokerData(load);
  const topics = state.data ?? [];

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = topics.filter((topic) =>
      needle === "" ? true : topicName(topic).toLowerCase().includes(needle),
    );
    return [...matched].sort((left, right) => {
      if (sort === "name") return topicName(left).localeCompare(topicName(right));
      if (sort === "produce") return right.rateIn - left.rateIn;
      return right.depth - left.depth;
    });
  }, [query, sort, topics]);

  const current = rows.find((topic) => topicName(topic) === selected);

  return (
    <Page>
      <PageHeader
        title="Topic"
        subtitle={t("board.topics.rocketmq.liveSubtitle", { count: topics.length })}
        actions={
          <Btn disabled={state.refreshing || !state.online} onClick={() => void state.refresh()}>
            {state.refreshing && <RefreshCw size={12} className="mqs-turning" aria-hidden />}
            {t("board.common.refresh")}
          </Btn>
        }
      />
      <Toolbar>
        <Field
          style={{ flex: "0 0 240px" }}
          placeholder={t("board.common.searchTopic")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "var(--c-mono-dim)" }}>
          <Sw checked={showSystem} onCheckedChange={setShowSystem} label={t("board.topics.rocketmq.showSystem")} />
          {t("board.topics.rocketmq.showSystem")}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ position: "relative" }}>
          <SelectField
            value={t(`board.topics.rocketmq.sort.${sort}`)}
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
                {t(`board.topics.rocketmq.sort.${key}`)}
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
                  <TH>Topic</TH>
                  <TH style={{ textAlign: "right" }}>{t("board.topics.rocketmq.queueRW")}</TH>
                  <TH style={{ textAlign: "right" }}>{t("board.common.produceTps")}</TH>
                  <TH style={{ textAlign: "right" }}>{t("board.common.consumerGroup")}</TH>
                  <TH style={{ textAlign: "right" }}>{t("board.common.backlog")}</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((topic) => {
                  const name = topicName(topic);
                  const internal = isInternal(name);
                  const dim = internal ? { color: "var(--c-muted)" } : undefined;
                  return (
                    <TR key={name} selected={selected === name} onClick={() => setSelected(name)}>
                      <TD style={dim}>
                        {internal ? name : <b style={{ fontWeight: 500 }}>{name}</b>}
                      </TD>
                      <TD className="mono3" style={{ textAlign: "right", ...dim }}>
                        {metric(readQueue(topic))} / {metric(writeQueue(topic))}
                      </TD>
                      <TD className="mono3" style={{ textAlign: "right", ...dim }}>
                        {metric(topic.rateIn)}
                      </TD>
                      <TD className="mono3" style={{ textAlign: "right", ...dim }}>
                        {metric(consumerGroups(topic))}
                      </TD>
                      <TD
                        className="mono3"
                        style={{
                          textAlign: "right",
                          ...dim,
                          ...(topic.depth > 0 && !internal ? { color: "var(--c-warn-text)" } : {}),
                        }}
                      >
                        {metric(topic.depth)}
                      </TD>
                    </TR>
                  );
                })}
                {rows.length === 0 && (
                  <TR>
                    <TD colSpan={5} style={{ padding: "34px", textAlign: "center", color: "var(--c-muted)" }}>
                      {t(topics.length === 0 ? "board.topics.rocketmq.noTopics" : "board.common.noMatch")}
                    </TD>
                  </TR>
                )}
              </TBody>
            </Table>
          </ListPane>

          {current != null && (
            <TopicSheet
              key={topicName(current)}
              topic={current}
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

interface QueueRow {
  brokerName: string;
  queueId: number;
  minOffset: number;
  maxOffset: number;
  messages: number;
}

function TopicSheet({
  topic,
  tab,
  onTabChange,
  onClose,
}: {
  topic: Destination;
  tab: string;
  onTabChange: (tab: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const name = topicName(topic);

  // Per-queue offsets are one request per topic, so they are fetched when a
  // topic is actually opened rather than for every row in the list.
  const load = useCallback(
    (id: number) => topicApi.getTopicStats(id, name),
    [name],
  );
  const stats = useBrokerData(load, { refreshMs: null });
  const queues = (stats.data?.["queues"] as QueueRow[] | undefined) ?? [];
  const route = routes(topic);

  return (
    <Sheet onDismiss={onClose}>
      <SheetHeader
        title={name}
        badge={<ProtoBadge protocol="rocketmq" label="RMQ" />}
        tabs={SHEET_TABS.map((id) => ({ id, label: t(id) }))}
        activeTab={tab}
        onTabChange={onTabChange}
        onClose={onClose}
      />
      <SheetBody>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
          <Card style={{ padding: "9px 12px" }}>
            <div style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>{t("board.common.produceTps")}</div>
            <div className="mono3" style={{ fontSize: "16px", fontWeight: 600, marginTop: "2px" }}>
              {metric(topic.rateIn)}
            </div>
          </Card>
          <Card style={{ padding: "9px 12px" }}>
            <div style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>{t("board.common.backlog")}</div>
            <div
              className="mono3"
              style={{
                fontSize: "16px",
                fontWeight: 600,
                marginTop: "2px",
                color: topic.depth > 0 ? "var(--c-warn-text)" : undefined,
              }}
            >
              {metric(topic.depth)}
            </div>
          </Card>
        </div>

        <KV
          rows={[
            [t("board.topics.rocketmq.perm"), perm(topic)],
            [t("board.topics.rocketmq.messageType"), messageType(topic)],
            [t("board.common.queue"), `${metric(readQueue(topic))} / ${metric(writeQueue(topic))}`],
          ]}
        />

        <div>
          <SectionLabel style={{ marginBottom: "6px" }}>{t("board.topics.rocketmq.queueSpread")}</SectionLabel>
          <Card style={{ overflow: "hidden" }}>
            {isBlocked(stats) ? (
              <BoardState state={stats} />
            ) : queues.length === 0 ? (
              <Notice title={t("board.topics.rocketmq.noQueues")} />
            ) : (
              <MiniTable>
                <THead>
                  <TR>
                    <TH>Broker</TH>
                    <TH style={{ textAlign: "right" }}>{t("board.common.queue")}</TH>
                    <TH style={{ textAlign: "right" }}>{t("board.topics.rocketmq.maxOffset")}</TH>
                  </TR>
                </THead>
                <TBody>
                  {queues.map((queue) => (
                    <TR key={`${queue.brokerName}-${queue.queueId}`}>
                      <TD className="mono3">{queue.brokerName}</TD>
                      <TD className="mono3" style={{ textAlign: "right" }}>
                        q{queue.queueId}
                      </TD>
                      <TD className="mono3" style={{ textAlign: "right" }}>
                        {queue.maxOffset.toLocaleString()}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </MiniTable>
            )}
          </Card>
        </div>

        {route.length > 0 && (
          <div>
            <SectionLabel style={{ marginBottom: "6px" }}>{t("board.topics.rocketmq.route")}</SectionLabel>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {route.map((one) => (
                <Status key={one.brokerAddr || one.broker} tone="ok">
                  {one.broker} · {one.readQueue}/{one.writeQueue} · {one.perm}
                </Status>
              ))}
            </div>
          </div>
        )}
      </SheetBody>
      <SheetFooter>
        <span style={{ flex: 1 }} />
      </SheetFooter>
    </Sheet>
  );
}
