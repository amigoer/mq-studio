import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  Plus,
  Tag,
  X,
  Server,
  Edit,
  Trash2,
  Check,
  ChevronRight,
  Send,
} from "lucide-react";
import { Spinner } from "@/components/Spinner";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { type Destination } from "@/api/models";
import {
  TopicMessageType,
  TopicPerm,
  cluster as topicCluster,
  consumerGroups as topicConsumerGroups,
  description as topicDescription,
  messageType as topicMessageType,
  perm as topicPerm,
  readQueue as topicReadQueue,
  routes as topicRoutes,
  topicName,
  writeQueue as topicWriteQueue,
} from "@/mq/rocketmq/destinations";
import { groupName, subscriptionsOf } from "@/mq/rocketmq/subscriptions";
import { PageHeader } from "@/components/PageHeader";
import { PageBody, PageToolbar } from "@/components/PageLayout";
import { DetailPanel } from "@/components/DetailPanel";
import { SectionLabel } from "@/components/SectionLabel";
import { StatCard } from "@/components/StatCard";
import { InfoRow } from "@/components/InfoRow";
import { formatCount, formatQueues, formatRateWithUnit } from "@/lib/format";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { useTopics } from "@/hooks/useTopics";
import { useConsumers } from "@/hooks/useConsumers";
import { useCluster } from "@/hooks/useCluster";
import { useDelayedUnmount } from "@/hooks/useDelayedUnmount";
import * as topicApi from "@/api/topic";
import { cn, formatErrorMessage } from "@/lib/utils";
import { activatableRowProps, ROW_FOCUS_CLASS } from "@/lib/a11y";
import { RefreshButton, usePageRefresh } from "@/components/RefreshButton";
import { SlidingTabs } from "@/components/SlidingTabs";
import { UnderlineTabs } from "@/components/UnderlineTabs";
import { EmptyState } from "@/components/EmptyState";
import { OfflineEmpty } from "@/components/OfflineEmpty";
import { ErrorBanner } from "@/components/ErrorBanner";
import type { NavId } from "@/layout/Sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

type TypeFilter = "all" | "normal" | "retry" | "dlq";
type TopicKind = "normal" | "fifo" | "delay" | "retry" | "dlq";

/** Shared grid template for the topics table header + rows. */
const TOPIC_COLS = "minmax(0,1fr) 6.77rem 4.92rem 7.38rem 5.54rem 2.15rem";

const RETRY_PREFIX = "%RETRY%";
const DLQ_PREFIX = "%DLQ%";

interface DerivedTopic {
  raw: Destination;
  kind: TopicKind;
  system: boolean;
}

/** Frontend safety net — backend also filters most system topics. */
function isLikelySystemTopic(name: string): boolean {
  const n = name.trim();
  if (!n) return true;
  if (n.startsWith(RETRY_PREFIX) || n.startsWith(DLQ_PREFIX)) return false;
  if (n.startsWith("RETRY%") || n.startsWith("DLQ%")) return false;
  if (n.startsWith("%")) return true;
  const u = n.toUpperCase();
  const l = n.toLowerCase();
  return (
    u.startsWith("RMQ_SYS_") ||
    l.startsWith("rmq_sys_") ||
    u.startsWith("SCHEDULE_TOPIC") ||
    n.startsWith("DefaultHeartBeat") ||
    u.includes("_REPLY_TOPIC") ||
    u.endsWith("REPLY_TOPIC") ||
    u.includes("WHEEL_TIMER") ||
    u.includes("REVIVE_LOG") ||
    u.includes("SYNC_BROKER_MEMBER") ||
    u.includes("ROCKSDB") ||
    u.includes("TRANS_HALF") ||
    [
      "TBW102",
      "BenchmarkTest",
      "DefaultCluster",
      "OFFSET_MOVED_EVENT",
      "SELF_TEST_TOPIC",
      "DefaultHeartBeatSyncerTopic",
    ].includes(n)
  );
}

function classifyTopic(t: Destination): TopicKind {
  if (
    topicName(t).startsWith(RETRY_PREFIX) ||
    topicName(t).startsWith("RETRY%")
  )
    return "retry";
  if (topicName(t).startsWith(DLQ_PREFIX) || topicName(t).startsWith("DLQ%"))
    return "dlq";
  if (topicMessageType(t) === TopicMessageType.FIFO) return "fifo";
  if (topicMessageType(t) === TopicMessageType.Delay) return "delay";
  return "normal";
}

/**
 * "普通" covers every business topic, ordered and delayed included, so the tab
 * counts always add up to the "全部" total.
 */
function matchesFilter(kind: TopicKind, filter: TypeFilter): boolean {
  if (filter === "all") return true;
  if (filter === "normal")
    return kind === "normal" || kind === "fifo" || kind === "delay";
  return kind === filter;
}

function permLabel(p: TopicPerm, t: (k: string) => string): string {
  switch (p) {
    case TopicPerm.ReadWrite:
      return t("topicPerm(topics).rw");
    case TopicPerm.ReadOnly:
      return t("topicPerm(topics).r");
    case TopicPerm.WriteOnly:
      return t("topicPerm(topics).w");
    case TopicPerm.Deny:
      return t("topicPerm(topics).deny");
    default:
      return p ? String(p) : "—";
  }
}

function typeBadgeClass(kind: TopicKind): string {
  // Topic-type colors stay as utility classes on Badge.
  switch (kind) {
    case "fifo":
      return "mqs-badge-topic-fifo";
    case "delay":
      return "mqs-badge-topic-delay";
    case "retry":
      return "mqs-badge-topic-retry";
    case "dlq":
      return "mqs-badge-topic-dlq";
    default:
      return "mqs-badge-topic-normal";
  }
}

function typeLabel(kind: TopicKind, t: (k: string) => string): string {
  return t(`topics.type.${kind}`);
}

export function TopicsPage({
  onNavigate,
}: {
  onNavigate?: (id: NavId) => void;
}) {
  const { t } = useTranslation();
  const { topics, loading, error, refresh, hasOnline } = useTopics();
  const { data: clusterData } = useCluster();

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [detail, setDetail] = useState<Destination | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState<
    { mode: "create" } | { mode: "edit"; topic: Destination } | null
  >(null);
  const [confirmDelete, setConfirmDelete] = useState<Destination | null>(null);
  const [deleting, setDeleting] = useState(false);

  const derived = useMemo<DerivedTopic[]>(
    () =>
      topics.map((raw) => ({
        raw,
        kind: classifyTopic(raw),
        system: isLikelySystemTopic(topicName(raw)),
      })),
    [topics],
  );

  const counts = useMemo(() => {
    const c = { all: 0, normal: 0, retry: 0, dlq: 0 };
    for (const d of derived) {
      if (d.system) continue;
      c.all++;
      if (d.kind === "retry") c.retry++;
      else if (d.kind === "dlq") c.dlq++;
      else c.normal++;
    }
    return c;
  }, [derived]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return derived
      .filter((d) => {
        // Hide internal system topics unless looking at retry/dlq intentionally
        if (d.system && d.kind !== "retry" && d.kind !== "dlq") return false;
        if (!matchesFilter(d.kind, typeFilter)) return false;
        if (
          q &&
          !topicName(d.raw).toLowerCase().includes(q) &&
          !(topicDescription(d.raw) || "").toLowerCase().includes(q)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        // Business topics first, then retry/dlq; alpha within group
        const rank = (k: TopicKind) =>
          k === "normal" || k === "fifo" || k === "delay"
            ? 0
            : k === "retry"
              ? 1
              : 2;
        const ra = rank(a.kind);
        const rb = rank(b.kind);
        if (ra !== rb) return ra - rb;
        return topicName(a.raw).localeCompare(topicName(b.raw));
      });
  }, [derived, search, typeFilter]);

  const dismissPanel = useCallback(() => {
    setSelectedName(null);
  }, []);

  const panelMount = useDelayedUnmount(!!(hasOnline && selectedName));
  // Keep the displayed item alive during the exit animation.
  const [pinnedDetail, setPinnedDetail] = useState<Destination | null>(null);
  useEffect(() => {
    if (detail) setPinnedDetail(detail);
  }, [detail]);

  // Esc closes the detail panel
  useEffect(() => {
    if (!selectedName) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismissPanel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedName, dismissPanel]);

  // Clicking the list pane outside any row closes the panel
  const handleListBackgroundClick = (e: React.MouseEvent) => {
    if (!selectedName) return;
    if ((e.target as HTMLElement).closest("[data-topic-row]")) return;
    dismissPanel();
  };

  // When selected name changes, fetch detail (with routes)
  useEffect(() => {
    let cancelled = false;
    if (!selectedName) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    topicApi
      .getTopicDetail(selectedName)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e) => {
        if (!cancelled) {
          setDetail(null);
          toast.error(formatErrorMessage(e));
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedName, topics]); // Sync detail after list refresh (including same-count content updates)

  const doRefresh = useCallback(() => refresh({ silent: true }), [refresh]);
  const { spinning: isRefreshing, refresh: handleRefresh } =
    usePageRefresh(doRefresh);

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await topicApi.deleteTopic(
        topicName(confirmDelete),
        topicCluster(confirmDelete) || "",
      );
      toast.success(t("topics.create.deleteSuccess"));
      setConfirmDelete(null);
      if (selectedName === topicName(confirmDelete)) setSelectedName(null);
      await refresh();
    } catch (e) {
      toast.error(formatErrorMessage(e));
    } finally {
      setDeleting(false);
    }
  };

  const subtitle = !hasOnline
    ? t("topics.subtitleNoConn")
    : search.trim() || typeFilter !== "all"
      ? t("topics.subtitleFiltered", {
          count: filtered.length,
          total: counts.all,
        })
      : t("topics.subtitle", { count: filtered.length });

  const filters: { key: TypeFilter; labelKey: string; count: number }[] = [
    { key: "all", labelKey: "topics.filterAll", count: counts.all },
    { key: "normal", labelKey: "topics.filterNormal", count: counts.normal },
    { key: "retry", labelKey: "topics.filterRetry", count: counts.retry },
    { key: "dlq", labelKey: "topics.filterDlq", count: counts.dlq },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={t("topics.title")} subtitle={subtitle}>
        <RefreshButton
          spinning={isRefreshing}
          disabled={!hasOnline}
          onClick={handleRefresh}
        />
        <Button
          variant="default"
          size="sm"
          onClick={() => setEditorOpen({ mode: "create" })}
          disabled={!hasOnline}
        >
          <Plus size={13} />
          {t("common.create")}
        </Button>
      </PageHeader>

      {hasOnline && (
        <PageToolbar>
          <div className="relative" style={{ width: "20rem" }}>
            <span className="pointer-events-none absolute left-2.5 top-1/2 z-[1] -translate-y-1/2 text-muted-foreground">
              <Search size={13} />
            </span>
            <Input
              className="pl-8"
              placeholder={t("topics.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <SlidingTabs
            value={typeFilter}
            onChange={setTypeFilter}
            items={filters.map((f) => ({
              key: f.key,
              label: t(f.labelKey),
              count: f.count,
            }))}
          />
          <div className="flex-1" />
          <span className="text-muted-foreground shrink-0 text-fs-115 tabular-nums">
            {t("topics.resultCount", { count: filtered.length })}
          </span>
        </PageToolbar>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <PageBody onClick={handleListBackgroundClick}>
          {!hasOnline ? (
            <OfflineEmpty
              message={t("topics.subtitleNoConn")}
              onAction={() => onNavigate?.("connections")}
            />
          ) : loading && topics.length === 0 ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 p-16">
              <Spinner size={14} />
              <span className="text-fs-12">{t("common.loading")}</span>
            </div>
          ) : (
            <>
              {error && (
                <ErrorBanner
                  message={t("topics.loadError", { message: error })}
                />
              )}
              {filtered.length === 0 ? (
                <EmptyState
                  icon={Tag}
                  title={t("topics.empty")}
                  description={t("topics.emptyHint")}
                  actionLabel={t("common.create")}
                  onAction={
                    typeFilter === "all" && !search.trim()
                      ? () => setEditorOpen({ mode: "create" })
                      : undefined
                  }
                />
              ) : (
                <div
                  className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-card"
                  style={{ minWidth: "49.23rem" }}
                >
                  <div
                    className="text-muted-foreground grid items-center gap-2 border-b border-border px-3.5 py-2 text-fs-11 font-medium"
                    style={{ gridTemplateColumns: TOPIC_COLS }}
                  >
                    <span>{t("topics.table.name")}</span>
                    <span className="text-right">
                      {t("topics.table.queues")}
                    </span>
                    <span>{t("topics.topicPerm(table)")}</span>
                    <span>{t("topics.table.tpsIn")}</span>
                    <span className="text-right">
                      {t("topics.table.groups")}
                    </span>
                    <span />
                  </div>
                  {filtered.map(({ raw, kind }) => {
                    const selected = selectedName === topicName(raw);
                    return (
                      <div
                        key={topicName(raw)}
                        data-topic-row
                        role="button"
                        aria-current={selected || undefined}
                        onClick={() => setSelectedName(topicName(raw))}
                        {...activatableRowProps(() =>
                          setSelectedName(topicName(raw)),
                        )}
                        className={cn(
                          "grid cursor-pointer items-center gap-2 border-t border-border px-3.5 py-2.5 transition-colors hover:bg-muted",
                          ROW_FOCUS_CLASS,
                          selected && "bg-accent hover:bg-accent",
                        )}
                        style={{ gridTemplateColumns: TOPIC_COLS }}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="font-mono-design truncate text-fs-12">
                            {topicName(raw)}
                          </span>
                          <Badge
                            variant="outline"
                            className={typeBadgeClass(kind) + " shrink-0"}
                          >
                            {typeLabel(kind, t)}
                          </Badge>
                        </div>
                        <span className="font-mono-design text-right text-fs-12 tabular-nums">
                          {formatQueues(
                            topicReadQueue(raw),
                            topicWriteQueue(raw),
                          )}
                        </span>
                        <span className="text-muted-foreground text-fs-115">
                          {permLabel(topicPerm(raw), t)}
                        </span>
                        <span className="font-mono-design text-muted-foreground text-fs-115 tabular-nums">
                          {formatRateWithUnit(raw.rateIn)}
                        </span>
                        <span className="font-mono-design text-muted-foreground text-right text-fs-12 tabular-nums">
                          {formatCount(topicConsumerGroups(raw))}
                        </span>
                        <ChevronRight
                          size={14}
                          className={cn(
                            "text-muted-foreground shrink-0 justify-self-end transition-opacity",
                            selected ? "opacity-70" : "opacity-50",
                          )}
                          aria-hidden
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </PageBody>

        {/* Detail panel */}
        {panelMount.shouldRender && (
          <TopicDetailPanel
            topic={detail ?? pinnedDetail}
            loading={detailLoading && !detail && !pinnedDetail}
            exiting={panelMount.exiting}
            onClose={dismissPanel}
            onEdit={(tp) => setEditorOpen({ mode: "edit", topic: tp })}
            onDelete={(tp) => setConfirmDelete(tp)}
            onSend={() => onNavigate?.("producer")}
            onBrowse={() => onNavigate?.("messages")}
          />
        )}
      </div>

      {/* Editor modal */}
      {editorOpen && (
        <TopicEditor
          mode={editorOpen.mode}
          initial={editorOpen.mode === "edit" ? editorOpen.topic : null}
          brokers={clusterData.brokers}
          onClose={() => setEditorOpen(null)}
          onSaved={async () => {
            setEditorOpen(null);
            await refresh();
          }}
        />
      )}

      <ConfirmDialog
        open={confirmDelete != null}
        title={t("topics.detail.actions.delete")}
        description={t("topics.detail.deleteConfirm", {
          name: confirmDelete ? topicName(confirmDelete) : "",
        })}
        confirmText={deleting ? t("common.loading") : t("common.delete")}
        cancelText={t("common.cancel")}
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => !deleting && setConfirmDelete(null)}
      />
    </div>
  );
}

// ---------- Detail Panel ----------

function TopicDetailPanel({
  topic,
  loading,
  exiting,
  onClose,
  onEdit,
  onDelete,
  onSend,
  onBrowse,
}: {
  topic: Destination | null;
  loading: boolean;
  exiting: boolean;
  onClose: () => void;
  onEdit: (t: Destination) => void;
  onDelete: (t: Destination) => void;
  onSend: (t: Destination) => void;
  onBrowse: (t: Destination) => void;
}) {
  const { t } = useTranslation();
  const { groups: consumerGroups, loading: groupsLoading } = useConsumers();
  const [tab, setTab] = useState<"info" | "routes" | "groups">("info");

  const relatedGroups = useMemo(() => {
    if (!topic) return [];
    const name = topicName(topic);
    return consumerGroups.filter((g) =>
      subscriptionsOf(g).some((s) => s.topic === name),
    );
  }, [consumerGroups, topic]);

  if (loading && !topic) {
    return (
      <DetailPanel exiting={exiting} ariaLabel={t("topics.title")}>
        <div
          className="text-muted-foreground flex items-center justify-center"
          style={{ padding: 60, gap: 8 }}
        >
          <Spinner size={14} />
          <span className="text-fs-12">{t("common.loading")}</span>
        </div>
      </DetailPanel>
    );
  }

  if (!topic) return null;

  const kind = classifyTopic(topic);
  const queueLabel = formatQueues(
    topicReadQueue(topic),
    topicWriteQueue(topic),
  );
  // Routes carry each broker's own queue counts. The stat reports the number of
  // readable queues across the cluster; the sub-label keeps the per-broker R/W
  // setting, which is what the edit form writes back.
  const totalQueue = topicRoutes(topic).length
    ? topicRoutes(topic).reduce((sum, r) => sum + Math.max(0, r.readQueue), 0)
    : topicReadQueue(topic) >= 0
      ? topicReadQueue(topic)
      : null;

  return (
    <DetailPanel exiting={exiting} ariaLabel={topicName(topic)}>
      <div style={{ padding: 20 }}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-mono-design truncate text-fs-14 font-semibold tracking-tight">
              {topicName(topic)}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Badge variant="outline" className={typeBadgeClass(kind)}>
                {typeLabel(kind, t)}
              </Badge>
              {topicPerm(topic) && (
                <Badge variant="outline">
                  {permLabel(topicPerm(topic), t)}
                </Badge>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            onClick={onClose}
          >
            <X size={14} />
          </Button>
        </div>

        <UnderlineTabs
          bleed
          className="mt-4"
          value={tab}
          onChange={setTab}
          items={(["info", "routes", "groups"] as const).map((k) => ({
            key: k,
            label: t(`topics.detail.tabs.${k}`),
          }))}
        />

        {tab === "info" && (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <StatCard
                label={t("topics.detail.stat.queues")}
                value={totalQueue != null ? totalQueue : "—"}
                valueClassName="text-fs-18"
                hint={queueLabel}
              />
              <StatCard
                label={t("topics.detail.stat.groups")}
                value={formatCount(topicConsumerGroups(topic))}
                valueClassName="text-fs-18"
              />
              <StatCard
                label={t("topics.detail.stat.rateIn")}
                value={formatRateWithUnit(topic.rateIn)}
                valueClassName="text-fs-16"
              />
              <StatCard
                label={t("topics.detail.stat.rateOut")}
                value={formatRateWithUnit(topic.rateOut)}
                valueClassName="text-fs-16"
              />
            </div>

            <SectionLabel>{t("topics.detail.info")}</SectionLabel>
            <div>
              {topicCluster(topic) && (
                <InfoRow label={t("topics.detail.infoCluster")}>
                  {topicCluster(topic)}
                </InfoRow>
              )}
              <InfoRow label={t("topics.detail.infoType")}>
                {typeLabel(kind, t)}
              </InfoRow>
              <InfoRow label={t("topics.detail.infoPerm")}>
                {permLabel(topicPerm(topic), t)}
              </InfoRow>
              <InfoRow
                label={t("topics.detail.infoQueues")}
                valueClassName="tabular-nums"
              >
                {queueLabel}
              </InfoRow>
              {topic.lastUpdated && (
                <InfoRow label={t("topics.detail.infoUpdated")} mono>
                  {topic.lastUpdated}
                </InfoRow>
              )}
              {topicDescription(topic) && (
                <InfoRow label={t("topics.detail.infoDesc")}>
                  {topicDescription(topic)}
                </InfoRow>
              )}
            </div>
          </>
        )}

        {tab === "routes" && (
          <div className="mt-4">
            {topicRoutes(topic).length === 0 ? (
              <EmptyState compact title={t("topics.detail.routesEmpty")} />
            ) : (
              <Card className="overflow-hidden">
                {topicRoutes(topic).map((r, i) => (
                  <div
                    key={`${r.broker}-${r.brokerAddr}`}
                    className="flex items-center justify-between"
                    style={{
                      padding: "10px 14px",
                      borderTop: i ? "1px solid hsl(var(--border))" : undefined,
                    }}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <Server size={13} className="text-muted-foreground" />
                      <span className="font-mono-design truncate text-fs-12">
                        {r.broker}
                      </span>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Badge variant="outline" className="text-fs-10">
                        R {r.readQueue}
                      </Badge>
                      <Badge variant="outline" className="text-fs-10">
                        W {r.writeQueue}
                      </Badge>
                    </div>
                  </div>
                ))}
              </Card>
            )}
          </div>
        )}

        {tab === "groups" && (
          <div className="mt-4">
            {groupsLoading && relatedGroups.length === 0 ? (
              <div className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-fs-12">
                <Spinner size={14} />
                {t("common.loading")}
              </div>
            ) : relatedGroups.length === 0 ? (
              <Card>
                <EmptyState compact title={t("topics.detail.groupsEmpty")} />
              </Card>
            ) : (
              <Card className="overflow-hidden">
                <div
                  className="text-muted-foreground px-3.5 py-2 text-fs-11"
                  style={{ borderBottom: "1px solid hsl(var(--border))" }}
                >
                  {t("topics.detail.groupsTitle")} · {relatedGroups.length}
                </div>
                {relatedGroups.map((g, i) => (
                  <div
                    key={groupName(g)}
                    className="flex items-center justify-between gap-2"
                    style={{
                      padding: "10px 14px",
                      borderTop: i ? "1px solid hsl(var(--border))" : undefined,
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-mono-design truncate text-fs-12 font-medium">
                        {groupName(g)}
                      </div>
                      <div className="text-muted-foreground mt-0.5 text-fs-11">
                        {t("common.instances", { count: g.members ?? 0 })}
                        {" · "}
                        lag {(g.backlog ?? 0).toLocaleString()}
                      </div>
                    </div>
                    <Badge
                      variant={
                        g.status === "online"
                          ? "success"
                          : g.status === "warning"
                            ? "warning"
                            : "outline"
                      }
                    >
                      {g.status || "—"}
                    </Badge>
                  </div>
                ))}
              </Card>
            )}
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2">
          <div className="flex gap-2">
            <Button
              variant="default"
              size="sm"
              className="flex-1"
              onClick={() => onSend(topic)}
            >
              <Send size={13} />
              {t("topics.detail.actions.send")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => onBrowse(topic)}
            >
              {t("topics.detail.actions.messages")}
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => onEdit(topic)}
            >
              <Edit size={13} />
              {t("topics.detail.actions.edit")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="flex-1"
              style={{ color: "hsl(var(--destructive))" }}
              onClick={() => onDelete(topic)}
            >
              <Trash2 size={13} />
              {t("topics.detail.actions.delete")}
            </Button>
          </div>
        </div>
      </div>
    </DetailPanel>
  );
}

// ---------- Editor Modal ----------

const DEFAULT_QUEUE_COUNT = 8;

/**
 * Queue counts live in each broker's own topic config, so the form must show
 * the numbers belonging to the broker it is about to write to. Falling back to
 * the topic-level summary keeps create mode and route-less items working.
 */
function queuesForBroker(
  topic: Destination | null,
  address: string,
): { read: number; write: number } {
  const route = topic
    ? topicRoutes(topic).find((r) => r.brokerAddr === address)
    : undefined;
  if (route) return { read: route.readQueue, write: route.writeQueue };
  const read = topic ? topicReadQueue(topic) : -1;
  const write = topic ? topicWriteQueue(topic) : -1;
  return {
    read: read > 0 ? read : DEFAULT_QUEUE_COUNT,
    write: write > 0 ? write : DEFAULT_QUEUE_COUNT,
  };
}

function TopicEditor({
  mode,
  initial,
  brokers,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  initial: Destination | null;
  brokers: import("@/api/models").BrokerNode[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const masterBrokers = useMemo(
    () =>
      brokers.filter(
        (b) =>
          String(b.role).toUpperCase() === "MASTER" &&
          b.status === "online" &&
          b.address,
      ),
    [brokers],
  );

  // The submit only ever targets one broker, so preselect a broker that the
  // select can actually show. Cluster data loads asynchronously, which is why
  // this is recomputed rather than captured once at mount.
  const defaultBroker = useMemo(() => {
    const options = masterBrokers.map((b) => b.address);
    const routed = (initial ? topicRoutes(initial) : [])
      .map((r) => r.brokerAddr)
      .find((address) => address && options.includes(address));
    return routed || options[0] || "";
  }, [initial, masterBrokers]);

  const isEdit = mode === "edit";

  const [name, setName] = useState(initial ? topicName(initial) : "");
  const [brokerAddr, setBrokerAddr] = useState<string>(defaultBroker);
  const [readQueue, setReadQueue] = useState<number>(
    () => queuesForBroker(initial, defaultBroker).read,
  );
  const [writeQueue, setWriteQueue] = useState<number>(
    () => queuesForBroker(initial, defaultBroker).write,
  );
  const [perm, setPerm] = useState<TopicPerm>(
    (initial && topicPerm(initial)) || TopicPerm.ReadWrite,
  );
  const [busy, setBusy] = useState(false);

  // Never leave the form holding an address the select cannot display, or the
  // user would be submitting a broker other than the one shown.
  useEffect(() => {
    setBrokerAddr((current) =>
      current && masterBrokers.some((b) => b.address === current)
        ? current
        : defaultBroker,
    );
  }, [defaultBroker, masterBrokers]);

  // Queue counts are a per-broker setting. Re-read them whenever the target
  // broker changes, so saving cannot copy one broker's numbers onto another.
  useEffect(() => {
    if (!isEdit) return;
    const queues = queuesForBroker(initial, brokerAddr);
    setReadQueue(queues.read);
    setWriteQueue(queues.write);
  }, [isEdit, initial, brokerAddr]);

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error(t("topics.create.namePlaceholder"));
      return;
    }
    if (!brokerAddr) {
      toast.error(t("topics.create.noBrokers"));
      return;
    }
    setBusy(true);
    try {
      if (isEdit) {
        await topicApi.updateTopic(
          name.trim(),
          brokerAddr,
          readQueue,
          writeQueue,
          perm,
        );
        toast.success(t("topics.create.saveSuccess", { name: name.trim() }));
      } else {
        await topicApi.createTopic(
          name.trim(),
          brokerAddr,
          readQueue,
          writeQueue,
          perm,
        );
        toast.success(t("topics.create.createSuccess", { name: name.trim() }));
      }
      await onSaved();
    } catch (e) {
      toast.error(formatErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={isEdit ? t("topics.create.edit") : t("topics.create.title")}
      dismissible={!busy}
      onClose={onClose}
      footer={
        <>
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant="default"
            size="sm"
            type="button"
            onClick={handleSubmit}
            disabled={busy || masterBrokers.length === 0}
          >
            {busy ? <Spinner size={13} /> : <Check size={13} />}
            {isEdit ? t("topics.create.save") : t("topics.create.submit")}
          </Button>
        </>
      }
    >
      <div className="mt-4 grid gap-3.5">
        <div>
          <div className="text-muted-foreground mb-2 text-fs-12">
            {t("topics.create.name")}{" "}
            <span style={{ color: "hsl(var(--destructive))" }}>*</span>
          </div>
          <Input
            className="font-mono-design"
            placeholder={t("topics.create.namePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isEdit}
          />
        </div>
        <div>
          <div className="text-muted-foreground mb-2 text-fs-12">
            {t("topics.create.broker")}{" "}
            <span style={{ color: "hsl(var(--destructive))" }}>*</span>
          </div>
          {masterBrokers.length === 0 ? (
            <div
              className="text-muted-foreground text-fs-12"
              style={{ padding: 8 }}
            >
              {t("topics.create.noBrokers")}
            </div>
          ) : (
            <Select
              value={brokerAddr}
              onChange={(e) => setBrokerAddr(e.target.value)}
            >
              {masterBrokers.map((b) => (
                <option key={b.address} value={b.address}>
                  {b.brokerName} · {b.address}
                </option>
              ))}
            </Select>
          )}
          <div className="text-muted-foreground mt-1 text-fs-11">
            {t("topics.create.brokerHint")}
          </div>
        </div>
        <div
          className="grid gap-3.5"
          style={{ gridTemplateColumns: "1fr 1fr" }}
        >
          <div>
            <div className="text-muted-foreground mb-2 text-fs-12">
              {t("topics.topicReadQueue(create)")}
            </div>
            <Input
              type="number"
              min={1}
              max={64}
              value={readQueue}
              onChange={(e) => setReadQueue(Number(e.target.value) || 1)}
            />
          </div>
          <div>
            <div className="text-muted-foreground mb-2 text-fs-12">
              {t("topics.topicWriteQueue(create)")}
            </div>
            <Input
              type="number"
              min={1}
              max={64}
              value={writeQueue}
              onChange={(e) => setWriteQueue(Number(e.target.value) || 1)}
            />
          </div>
        </div>
        <div>
          <div className="text-muted-foreground mb-2 text-fs-12">
            {t("topics.topicPerm(create)")}
          </div>
          <Select
            value={perm}
            onChange={(e) => setPerm(e.target.value as TopicPerm)}
          >
            <option value={TopicPerm.ReadWrite}>
              {t("topicPerm(topics).rw")}
            </option>
            <option value={TopicPerm.ReadOnly}>
              {t("topicPerm(topics).r")}
            </option>
            <option value={TopicPerm.WriteOnly}>
              {t("topicPerm(topics).w")}
            </option>
            <option value={TopicPerm.Deny}>
              {t("topicPerm(topics).deny")}
            </option>
          </Select>
        </div>
      </div>
    </Modal>
  );
}
