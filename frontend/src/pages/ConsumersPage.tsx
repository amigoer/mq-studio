import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ConsumeMode,
  clientsOf,
  cluster as groupCluster,
  consumeMode as groupConsumeMode,
  groupName,
  maxRetry as groupMaxRetry,
  subscriptionsOf,
  type GroupSubscription,
} from "@/mq/rocketmq/subscriptions";

import {
  Search,
  AlertCircle,
  Users,
  X,
  Tag,
  RotateCcw,
  Edit,
  Plus,
  Check,
  Trash2,
  ChevronRight,
} from "lucide-react";
import { Spinner } from "@/components/Spinner";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { type Subscription } from "@/api/models";
import { PageHeader } from "@/components/PageHeader";
import { PageBody, PageToolbar } from "@/components/PageLayout";
import { DetailPanel } from "@/components/DetailPanel";
import { SectionLabel } from "@/components/SectionLabel";
import { InfoRow } from "@/components/InfoRow";
import { formatCount, formatRate } from "@/lib/format";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { useConsumers } from "@/hooks/useConsumers";
import { useCluster } from "@/hooks/useCluster";
import { useDelayedUnmount } from "@/hooks/useDelayedUnmount";
import * as consumerApi from "@/api/consumer";
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
import { brokerName, role as brokerRole } from "@/mq/rocketmq/nodes";

type StatusFilter = "all" | "online" | "warning" | "offline";

/** Shared grid template for the consumer-group table header + rows. */
const GROUP_COLS =
  "minmax(0,1.1fr) minmax(0,1fr) 7.38rem 5.85rem 4.31rem 6.77rem 2.15rem";

export function ConsumersPage({
  onNavigate,
}: {
  onNavigate?: (id: NavId) => void;
}) {
  const { t } = useTranslation();
  const { groups, loading, error, refresh, hasOnline } = useConsumers();
  const { data: clusterData } = useCluster();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState<
    { mode: "create" } | { mode: "edit"; group: Subscription } | null
  >(null);
  const [resetTarget, setResetTarget] = useState<Subscription | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Subscription | null>(null);
  const [deleting, setDeleting] = useState(false);

  const counts = useMemo(() => {
    const c = { all: groups.length, online: 0, warning: 0, offline: 0 };
    for (const g of groups) {
      if (g.status === "online") c.online++;
      else if (g.status === "warning") c.warning++;
      else if (g.status === "offline") c.offline++;
    }
    return c;
  }, [groups]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups.filter((g) => {
      if (statusFilter !== "all" && g.status !== statusFilter) return false;
      if (q) {
        const inName = groupName(g).toLowerCase().includes(q);
        const inSubs = (subscriptionsOf(g) || []).some((s) =>
          s.topic.toLowerCase().includes(q),
        );
        if (!inName && !inSubs) return false;
      }
      return true;
    });
  }, [groups, search, statusFilter]);

  const dismissPanel = useCallback(() => {
    setSelectedName(null);
  }, []);

  // Esc closes the detail panel
  useEffect(() => {
    if (!selectedName) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismissPanel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedName, dismissPanel]);

  // Clicking the list pane outside any row also closes the panel
  const handleListBackgroundClick = (e: React.MouseEvent) => {
    if (!selectedName) return;
    if ((e.target as HTMLElement).closest("[data-consumer-row]")) return;
    dismissPanel();
  };

  const selected = useMemo<Subscription | null>(
    () => groups.find((g) => groupName(g) === selectedName) ?? null,
    [groups, selectedName],
  );
  const panelMount = useDelayedUnmount(!!(hasOnline && selected));
  // Keep the displayed item alive during the exit animation.
  const [pinnedSelected, setPinnedSelected] = useState<Subscription | null>(
    null,
  );
  useEffect(() => {
    if (selected) setPinnedSelected(selected);
  }, [selected]);
  const renderedSelected = selected ?? pinnedSelected;

  const doRefresh = useCallback(() => refresh({ silent: true }), [refresh]);
  const { spinning: isRefreshing, refresh: handleRefresh } =
    usePageRefresh(doRefresh);

  const handleDelete = async () => {
    if (!confirmDelete) return;
    // Pick first master broker as the target for delete (RocketMQ requires it)
    const broker = clusterData.nodes.find(
      (b) => String(brokerRole(b)).toUpperCase() === "MASTER" && b.address,
    );
    if (!broker) {
      toast.error(t("consumers.edit.noBrokers"));
      return;
    }
    setDeleting(true);
    try {
      await consumerApi.deleteConsumerGroup(
        groupName(confirmDelete),
        broker.address,
      );
      toast.success(t("consumers.detail.deleteSuccess"));
      if (selectedName === groupName(confirmDelete)) setSelectedName(null);
      setConfirmDelete(null);
      await refresh();
    } catch (e) {
      toast.error(formatErrorMessage(e));
    } finally {
      setDeleting(false);
    }
  };

  const subtitle = !hasOnline
    ? t("consumers.subtitleNoConn")
    : filtered.length === groups.length
      ? t("consumers.subtitle", { count: groups.length })
      : t("consumers.subtitleFiltered", {
          count: filtered.length,
          total: groups.length,
        });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={t("consumers.title")} subtitle={subtitle}>
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
              placeholder={t("consumers.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <SlidingTabs
            value={statusFilter}
            onChange={setStatusFilter}
            items={[
              {
                key: "all",
                label: t("consumers.filterAll"),
                count: counts.all,
              },
              {
                key: "online",
                label: t("consumers.filterOnline"),
                count: counts.online,
              },
              {
                key: "warning",
                label: t("consumers.filterWarning"),
                count: counts.warning,
              },
              {
                key: "offline",
                label: t("consumers.filterOffline"),
                count: counts.offline,
              },
            ]}
          />
          <div className="flex-1" />
          <span className="text-muted-foreground shrink-0 text-fs-115 tabular-nums">
            {t("consumers.resultCount", { count: filtered.length })}
          </span>
        </PageToolbar>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <PageBody onClick={handleListBackgroundClick}>
          {!hasOnline ? (
            <OfflineEmpty
              message={t("consumers.subtitleNoConn")}
              onAction={() => onNavigate?.("connections")}
            />
          ) : loading && groups.length === 0 ? (
            <div
              className="text-muted-foreground flex items-center justify-center"
              style={{ padding: 60, gap: 8 }}
            >
              <Spinner size={14} />
              <span className="text-fs-12">{t("common.loading")}</span>
            </div>
          ) : (
            <>
              {error && (
                <ErrorBanner
                  message={t("consumers.loadError", { message: error })}
                />
              )}
              {filtered.length === 0 ? (
                <EmptyState icon={Users} title={t("consumers.empty")} />
              ) : (
                <div
                  className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-card"
                  style={{ minWidth: "55.38rem" }}
                >
                  <div
                    className="text-muted-foreground grid items-center gap-2 border-b border-border px-3.5 py-2 text-fs-11 font-medium"
                    style={{ gridTemplateColumns: GROUP_COLS }}
                  >
                    <span>{t("consumers.table.name")}</span>
                    <span>{t("consumers.table.topic")}</span>
                    <span>{t("consumers.table.model")}</span>
                    <span>{t("consumers.table.status")}</span>
                    <span className="text-right">
                      {t("consumers.table.instances")}
                    </span>
                    <span className="text-right">
                      {t("consumers.table.lag")}
                    </span>
                    <span />
                  </div>
                  {filtered.map((g) => {
                    const subTopic =
                      subscriptionsOf(g)[0]?.topic ||
                      (g.destinations > 0 ? `${g.destinations} topics` : "—");
                    const selected = selectedName === groupName(g);
                    const statusText =
                      g.status === "online"
                        ? t("common.online")
                        : g.status === "warning"
                          ? t("consumers.filterWarning")
                          : t("common.offline");
                    return (
                      <div
                        key={groupName(g)}
                        data-consumer-row
                        role="button"
                        aria-current={selected || undefined}
                        onClick={() => setSelectedName(groupName(g))}
                        {...activatableRowProps(() =>
                          setSelectedName(groupName(g)),
                        )}
                        className={cn(
                          "grid cursor-pointer items-center gap-2 border-t border-border px-3.5 py-2.5 transition-colors hover:bg-muted",
                          ROW_FOCUS_CLASS,
                          selected && "bg-accent hover:bg-accent",
                        )}
                        style={{ gridTemplateColumns: GROUP_COLS }}
                      >
                        <span className="font-mono-design truncate text-fs-12">
                          {groupName(g)}
                        </span>
                        <span className="text-muted-foreground truncate text-fs-115">
                          {subTopic}
                        </span>
                        <span className="font-mono-design text-muted-foreground truncate text-fs-105">
                          {groupConsumeMode(g) || "—"}
                        </span>
                        <span className="inline-flex min-w-0 items-center gap-1.5 text-fs-115">
                          <span
                            className={cn(
                              "h-1.5 w-1.5 shrink-0 rounded-full",
                              g.status === "online"
                                ? "bg-[hsl(var(--success))]"
                                : g.status === "warning"
                                  ? "bg-[hsl(var(--warning))]"
                                  : g.status === "offline"
                                    ? "bg-[hsl(var(--destructive)/0.55)]"
                                    : "bg-[hsl(var(--muted-foreground)/0.35)]",
                            )}
                          />
                          <span className="truncate">{statusText}</span>
                        </span>
                        <span className="font-mono-design text-right text-fs-12 tabular-nums">
                          {g.members}
                        </span>
                        <span
                          className={cn(
                            "font-mono-design text-right text-fs-12 tabular-nums",
                            g.backlog > 1000
                              ? "text-destructive"
                              : "text-muted-foreground",
                          )}
                        >
                          {formatCount(g.backlog)}
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

        {panelMount.shouldRender && renderedSelected && (
          <GroupDetailPanel
            group={renderedSelected}
            exiting={panelMount.exiting}
            onClose={dismissPanel}
            onReset={() => setResetTarget(renderedSelected)}
            onEdit={() =>
              setEditorOpen({ mode: "edit", group: renderedSelected })
            }
            onDelete={() => setConfirmDelete(renderedSelected)}
          />
        )}
      </div>

      {editorOpen && (
        <GroupEditor
          mode={editorOpen.mode}
          initial={editorOpen.mode === "edit" ? editorOpen.group : null}
          brokers={clusterData.nodes}
          onClose={() => setEditorOpen(null)}
          onSaved={async () => {
            setEditorOpen(null);
            await refresh();
          }}
        />
      )}

      {resetTarget && (
        <ResetOffsetDialog
          group={resetTarget}
          onClose={() => setResetTarget(null)}
          onDone={async () => {
            setResetTarget(null);
            await refresh();
          }}
        />
      )}

      <ConfirmDialog
        open={confirmDelete != null}
        title={t("consumers.detail.actions.delete")}
        description={t("consumers.detail.deleteConfirm", {
          name: confirmDelete ? groupName(confirmDelete) : "",
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

function GroupDetailPanel({
  group,
  exiting,
  onClose,
  onReset,
  onEdit,
  onDelete,
}: {
  group: Subscription;
  exiting: boolean;
  onClose: () => void;
  onReset: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<
    "overview" | "instances" | "subscriptions" | "config"
  >("overview");
  const tps = useMemo(
    () =>
      (subscriptionsOf(group) || []).reduce(
        (s, sub) => s + (sub.consumeTps || 0),
        0,
      ),
    [subscriptionsOf(group)],
  );

  return (
    <DetailPanel exiting={exiting} ariaLabel={groupName(group)} layout="column">
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid hsl(var(--border))",
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Users size={15} className="text-muted-foreground" />
            <span className="font-mono-design truncate font-semibold">
              {groupName(group)}
            </span>
            {group.backlog > 1000 && (
              <Badge variant="warning" className="shrink-0">
                {t("consumers.table.lag")}
              </Badge>
            )}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X size={14} />
          </Button>
        </div>
        <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-2 text-fs-12">
          <Tag size={11} />
          <span>
            {group.destinations} {t("topics.title")}
          </span>
          <span
            style={{
              width: 3,
              height: 3,
              borderRadius: 999,
              background: "hsl(var(--border))",
            }}
          />
          <span>{groupConsumeMode(group) || "—"}</span>
          <span
            style={{
              width: 3,
              height: 3,
              borderRadius: 999,
              background: "hsl(var(--border))",
            }}
          />
          <span>
            {group.members} {t("consumers.detail.instances")}
          </span>
        </div>
      </div>

      <UnderlineTabs
        value={tab}
        onChange={setTab}
        items={(
          ["overview", "subscriptions", "instances", "config"] as const
        ).map((k) => ({
          key: k,
          label: t(`consumers.tabs.${k}`),
          count: k === "instances" ? group.members : undefined,
        }))}
      />

      <div
        className="scroll-thin min-h-0 flex-1 overflow-auto"
        style={{ padding: "16px 20px" }}
      >
        {tab === "overview" && (
          <>
            <div
              className="grid"
              style={{
                gridTemplateColumns: "1fr 1fr 1fr",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "12px 14px" }}>
                <div className="text-muted-foreground text-fs-12">
                  {t("consumers.stat.instances")}
                </div>
                <div className="tabular-nums mt-1 text-fs-18 font-semibold">
                  {group.members}
                </div>
              </div>
              <div
                style={{
                  padding: "12px 14px",
                  borderLeft: "1px solid hsl(var(--border))",
                }}
              >
                <div className="flex items-center gap-1">
                  <div className="text-muted-foreground text-fs-12">
                    {t("consumers.stat.lag")}
                  </div>
                  {group.backlog > 1000 && (
                    <AlertCircle
                      size={10}
                      style={{ color: "hsl(var(--warning))" }}
                    />
                  )}
                </div>
                <div
                  className="tabular-nums mt-1 text-fs-18 font-semibold"
                  style={{
                    color:
                      group.backlog > 1000 ? "hsl(var(--warning))" : undefined,
                  }}
                >
                  {formatCount(group.backlog)}
                </div>
              </div>
              <div
                style={{
                  padding: "12px 14px",
                  borderLeft: "1px solid hsl(var(--border))",
                }}
              >
                <div className="text-muted-foreground text-fs-12">
                  {t("consumers.stat.tps")}
                </div>
                <div className="mt-1 flex items-center gap-1">
                  <span className="tabular-nums text-fs-18 font-semibold">
                    {formatRate(tps)}
                  </span>
                  <span
                    className="text-muted-foreground text-fs-12"
                    style={{ marginBottom: 1 }}
                  >
                    /s
                  </span>
                </div>
              </div>
            </div>

            <SectionLabel>{t("consumers.detail.subscriptions")}</SectionLabel>
            <SubscriptionList subs={subscriptionsOf(group)} />
          </>
        )}

        {tab === "subscriptions" && (
          <>
            <SectionLabel first>
              {t("consumers.detail.subscriptions")}
            </SectionLabel>
            <SubscriptionList subs={subscriptionsOf(group)} />
          </>
        )}

        {tab === "instances" && (
          <>
            <SectionLabel first>{t("consumers.detail.instances")}</SectionLabel>
            {clientsOf(group).length === 0 ? (
              <EmptyState
                compact
                title={t("consumers.detail.instancesEmpty")}
              />
            ) : (
              <Card className="overflow-hidden">
                {clientsOf(group).map((c, i) => (
                  <div
                    key={c.clientId}
                    style={{
                      padding: "10px 14px",
                      borderTop: i ? "1px solid hsl(var(--border))" : undefined,
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono-design truncate text-fs-12">
                        {c.clientId}
                      </span>
                      {c.version && (
                        <Badge variant="outline" className="text-fs-10">
                          {c.version}
                        </Badge>
                      )}
                    </div>
                    <div
                      className="text-muted-foreground mt-1 flex items-center gap-2 text-fs-11"
                      style={{ fontFamily: "monospace" }}
                    >
                      <span>{c.ip}</span>
                      {c.lastHeartbeat && (
                        <>
                          <span>·</span>
                          <span>{c.lastHeartbeat}</span>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </Card>
            )}
          </>
        )}

        {tab === "config" && (
          <>
            <SectionLabel first>{t("consumers.detail.config")}</SectionLabel>
            <div>
              <InfoRow label={t("consumers.detail.configMode")}>
                {groupConsumeMode(group) || "—"}
              </InfoRow>
              <InfoRow
                label={t("consumers.detail.configMaxRetry")}
                valueClassName="tabular-nums"
              >
                {groupMaxRetry(group)}
              </InfoRow>
              {groupCluster(group) && (
                <InfoRow label={t("consumers.detail.configCluster")}>
                  {groupCluster(group)}
                </InfoRow>
              )}
              {group.lastUpdated && (
                <InfoRow label={t("consumers.detail.configLastUpdate")} mono>
                  {group.lastUpdated}
                </InfoRow>
              )}
            </div>
          </>
        )}
      </div>

      <div
        className="bg-background flex items-center gap-2"
        style={{
          padding: "12px 20px",
          borderTop: "1px solid hsl(var(--border))",
        }}
      >
        <Button variant="outline" size="sm" onClick={onReset}>
          <RotateCcw size={13} />
          {t("consumers.detail.actions.reset")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          style={{ marginLeft: "auto" }}
          onClick={onEdit}
        >
          <Edit size={13} />
          {t("consumers.detail.actions.edit")}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          style={{ color: "hsl(var(--destructive))" }}
          onClick={onDelete}
        >
          <Trash2 size={14} />
        </Button>
      </div>
    </DetailPanel>
  );
}

function SubscriptionList({ subs }: { subs: GroupSubscription[] }) {
  const { t } = useTranslation();
  if (subs.length === 0) {
    return (
      <EmptyState compact title={t("consumers.detail.subscriptionsEmpty")} />
    );
  }
  return (
    <Card className="overflow-hidden">
      {subs.map((s, i) => (
        <div
          key={s.topic}
          className="flex items-center gap-2"
          style={{
            padding: "10px 14px",
            borderTop: i ? "1px solid hsl(var(--border))" : undefined,
          }}
        >
          <Tag size={12} className="text-muted-foreground" />
          <span className="font-mono-design flex-1 truncate text-fs-13">
            {s.topic}
          </span>
          {s.expression && s.expression !== "*" && (
            <span
              className="font-mono-design text-muted-foreground text-fs-11"
              title="Tag filter"
              style={{ maxWidth: "9.23rem" }}
            >
              {s.expression}
            </span>
          )}
          {s.consumeTps > 0 && (
            <span className="font-mono-design tabular-nums text-muted-foreground text-fs-12">
              {formatRate(s.consumeTps)}/s
            </span>
          )}
        </div>
      ))}
    </Card>
  );
}

// ---------- Reset offset ----------

function ResetOffsetDialog({
  group,
  onClose,
  onDone,
}: {
  group: Subscription;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [topic, setTopic] = useState<string>(
    subscriptionsOf(group)[0]?.topic ?? "",
  );
  const [mode, setMode] = useState<"now" | "earliest" | "custom">("now");
  const [custom, setCustom] = useState<string>("");
  const [force, setForce] = useState(true);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    if (!topic) {
      toast.error(t("consumers.reset.topicHint"));
      return;
    }
    let timestamp = 0;
    if (mode === "now") timestamp = Date.now();
    else if (mode === "custom") {
      const ms = Date.parse(custom);
      if (Number.isNaN(ms)) {
        toast.error(t("consumers.reset.timeCustom"));
        return;
      }
      timestamp = ms;
    }
    setBusy(true);
    try {
      await consumerApi.resetOffset(groupName(group), topic, timestamp, force);
      toast.success(t("consumers.reset.success"));
      await onDone();
    } catch (e) {
      toast.error(t("consumers.reset.error"), {
        description: formatErrorMessage(e),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={t("consumers.reset.title")}
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
            disabled={busy}
          >
            {busy ? <Spinner size={13} /> : <RotateCcw size={13} />}
            {t("consumers.reset.submit")}
          </Button>
        </>
      }
    >
      <div className="mt-4 grid gap-3.5">
        <div>
          <div className="text-muted-foreground mb-2 text-fs-12">
            {t("consumers.reset.topic")}
          </div>
          {subscriptionsOf(group).length === 0 ? (
            <Input
              className="font-mono-design"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
          ) : (
            <Select value={topic} onChange={(e) => setTopic(e.target.value)}>
              {subscriptionsOf(group).map((s) => (
                <option key={s.topic} value={s.topic}>
                  {s.topic}
                </option>
              ))}
            </Select>
          )}
        </div>
        <div>
          <div className="text-muted-foreground mb-2 text-fs-12">
            {t("consumers.reset.time")}
          </div>
          <div className="flex flex-col gap-2">
            <label
              className="flex items-center gap-2 text-fs-13"
              style={{ cursor: "pointer" }}
            >
              <input
                type="radio"
                checked={mode === "now"}
                onChange={() => setMode("now")}
              />
              {t("consumers.reset.timeNow")}
            </label>
            <label
              className="flex items-center gap-2 text-fs-13"
              style={{ cursor: "pointer" }}
            >
              <input
                type="radio"
                checked={mode === "earliest"}
                onChange={() => setMode("earliest")}
              />
              {t("consumers.reset.timeEarliest")}
            </label>
            <label
              className="flex items-center gap-2 text-fs-13"
              style={{ cursor: "pointer" }}
            >
              <input
                type="radio"
                checked={mode === "custom"}
                onChange={() => setMode("custom")}
              />
              {t("consumers.reset.timeCustom")}
            </label>
            {mode === "custom" && (
              <Input
                className="font-mono-design"
                type="datetime-local"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
              />
            )}
          </div>
        </div>
        <label
          className="flex items-center gap-2 text-fs-13"
          style={{ cursor: "pointer" }}
        >
          <input
            type="checkbox"
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
          />
          {t("consumers.reset.force")}
        </label>
      </div>
    </Modal>
  );
}

// ---------- Editor ----------

function GroupEditor({
  mode,
  initial,
  brokers,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  initial: Subscription | null;
  brokers: import("@/api/models").Node[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const masterBrokers = useMemo(
    () =>
      brokers.filter(
        (b) =>
          String(brokerRole(b)).toUpperCase() === "MASTER" &&
          b.status === "online" &&
          b.address,
      ),
    [brokers],
  );

  const [name, setName] = useState(initial ? groupName(initial) : "");
  const [brokerAddr, setBrokerAddr] = useState<string>(
    masterBrokers[0]?.address || "",
  );
  const [consumeMode, setConsumeMode] = useState<ConsumeMode>(
    initial ? groupConsumeMode(initial) : ConsumeMode.Clustering,
  );
  const [maxRetry, setMaxRetry] = useState<number>(
    initial ? groupMaxRetry(initial) : 16,
  );
  const [busy, setBusy] = useState(false);

  const isEdit = mode === "edit";

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error(t("consumers.edit.namePlaceholder"));
      return;
    }
    if (!brokerAddr) {
      toast.error(t("consumers.edit.noBrokers"));
      return;
    }
    setBusy(true);
    try {
      if (isEdit) {
        await consumerApi.updateConsumerGroup(
          name.trim(),
          brokerAddr,
          consumeMode,
          maxRetry,
        );
        toast.success(t("consumers.edit.saveSuccess", { name: name.trim() }));
      } else {
        await consumerApi.createConsumerGroup(
          name.trim(),
          brokerAddr,
          consumeMode,
          maxRetry,
        );
        toast.success(t("consumers.edit.createSuccess", { name: name.trim() }));
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
      title={
        isEdit ? t("consumers.edit.title") : t("consumers.edit.createTitle")
      }
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
            {isEdit
              ? t("consumers.edit.submit")
              : t("consumers.edit.createSubmit")}
          </Button>
        </>
      }
    >
      <div className="mt-4 grid gap-3.5">
        <div>
          <div className="text-muted-foreground mb-2 text-fs-12">
            {t("consumers.edit.name")}{" "}
            <span style={{ color: "hsl(var(--destructive))" }}>*</span>
          </div>
          <Input
            className="font-mono-design"
            placeholder={t("consumers.edit.namePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isEdit}
          />
        </div>
        <div>
          <div className="text-muted-foreground mb-2 text-fs-12">
            {t("consumers.edit.broker")}{" "}
            <span style={{ color: "hsl(var(--destructive))" }}>*</span>
          </div>
          {masterBrokers.length === 0 ? (
            <div
              className="text-muted-foreground text-fs-12"
              style={{ padding: 8 }}
            >
              {t("consumers.edit.noBrokers")}
            </div>
          ) : (
            <Select
              value={brokerAddr}
              onChange={(e) => setBrokerAddr(e.target.value)}
            >
              {masterBrokers.map((b) => (
                <option key={b.address} value={b.address}>
                  {brokerName(b)} · {b.address}
                </option>
              ))}
            </Select>
          )}
          <div className="text-muted-foreground mt-1 text-fs-11">
            {t("consumers.edit.brokerHint")}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground mb-2 text-fs-12">
            {t("consumers.edit.mode")}
          </div>
          <Select
            value={consumeMode}
            onChange={(e) => setConsumeMode(e.target.value as ConsumeMode)}
          >
            <option value={ConsumeMode.Clustering}>
              {t("consumers.detail.modeClustering")}
            </option>
            <option value={ConsumeMode.Broadcasting}>
              {t("consumers.detail.modeBroadcasting")}
            </option>
          </Select>
          <div className="text-muted-foreground mt-1 text-fs-11">
            {t("consumers.edit.modeHint")}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground mb-2 text-fs-12">
            {t("consumers.edit.maxRetry")}
          </div>
          <Input
            type="number"
            min={0}
            max={64}
            value={maxRetry}
            onChange={(e) => setMaxRetry(Number(e.target.value) || 0)}
          />
        </div>
      </div>
    </Modal>
  );
}
