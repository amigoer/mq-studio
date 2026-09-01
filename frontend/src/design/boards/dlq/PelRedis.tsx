import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BulkBar, ListArea, ListPane, Page, PageHeader, RefreshButton, Toolbar } from "@/design/shell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Panel, SectionLabel, SelectField, Status, toast, useConfirm } from "@/components";
import { BoardState } from "@/design/boards/BoardState";
import { ClaimDialog } from "./ClaimDialog";
import { useRedisGroups } from "@/hooks/redis/useRedisGroups";
import { useRedisPending } from "@/hooks/redis/useRedisPending";
import { useConnectionScope } from "@/mq/ConnectionScope";
import * as redisApi from "@/api/redis";
import { formatCount } from "@/lib/format";
import { formatErrorMessage } from "@/lib/utils";
import { groupKey, groupName, groupStream } from "@/mq/redis/subscriptions";
import {
  consumerHealth,
  consumerInactiveMs,
  dominantConsumer,
  formatIdle,
  oldestPendingId,
  type ConsumerHealth,
} from "@/mq/redis/pending";

const MONO11 = { fontSize: "11px" } as const;
const RIGHT = { textAlign: "right" } as const;

/** The idle thresholds the filter offers, in milliseconds. */
const THRESHOLDS = [0, 60_000, 300_000, 3_600_000] as const;

const CONSUMER_TONE: Record<ConsumerHealth, "ok" | "warn" | "off"> = {
  working: "ok",
  abandoned: "warn",
  idle: "off",
};

/**
 * Board 15d — Redis pending entries.
 *
 * Redis has no dead-letter queue. Nothing is moved and nothing is given up on:
 * an entry handed to a consumer stays in the stream and stays owed to that
 * consumer until it acknowledges it or somebody claims it away. So this page
 * is the claim-and-acknowledge console rather than a list of discarded
 * messages, and the two columns that matter are how long an entry has been
 * sitting and how many times it has been tried.
 *
 * The acknowledge is the quietly destructive one and is confirmed as such: it
 * settles the entry without anything having processed it, the entry stays in
 * the stream, and the group never reads it again.
 */
export function PelRedis() {
  const { t } = useTranslation();
  const groups = useRedisGroups();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();

  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [minIdleMs, setMinIdleMs] = useState<number>(THRESHOLDS[0]);
  const [checked, setChecked] = useState<string[]>([]);
  const [claiming, setClaiming] = useState<"selection" | "auto" | null>(null);

  const groupRows = useMemo(() => groups.data ?? [], [groups.data]);

  /* Land on a group as soon as one is known, so the page has something to read
     rather than an empty picker. */
  useEffect(() => {
    const first = groupRows[0];
    if (selectedGroup == null && first != null) setSelectedGroup(groupKey(first));
  }, [groupRows, selectedGroup]);

  const current = useMemo(
    () => groupRows.find((group) => groupKey(group) === selectedGroup) ?? null,
    [groupRows, selectedGroup],
  );
  const stream = current == null ? null : groupStream(current);
  const group = current == null ? null : groupName(current);

  const pending = useRedisPending(stream, group, minIdleMs);
  const summary = pending.data?.summary ?? null;
  const entries = useMemo(() => pending.data?.entries ?? [], [pending.data]);
  const consumers = useMemo(() => pending.data?.consumers ?? [], [pending.data]);

  const dominant = summary == null ? null : dominantConsumer(summary);

  const clearAndRefresh = useCallback(async () => {
    setChecked([]);
    await Promise.all([pending.refresh(), groups.refresh()]);
  }, [groups, pending]);

  const acknowledge = useCallback(async () => {
    if (stream == null || group == null || checked.length === 0) return;
    const ok = await confirm({
      title: t("board.dlq.redis.ackTitle", { count: checked.length }),
      /* The warning is the whole point. Acknowledging settles the entry with
         nothing having processed it: it stays in the stream and this group
         never reads it again, and nothing afterwards distinguishes that from
         work that was actually done. */
      description: t("board.dlq.redis.ackHint"),
      confirmLabel: t("board.dlq.redis.ackConfirm"),
      danger: true,
    });
    if (!ok) return;
    try {
      const { acknowledged } = await redisApi.ackEntries(connID, stream, group, checked);
      if (acknowledged === 0) {
        /* XACK succeeds on entries that are no longer owed. Reporting the
           request count would call that a success when somebody else had
           already settled them. */
        toast.error(t("board.dlq.redis.ackNone"));
      } else {
        toast.success(t("board.dlq.redis.acked", { count: acknowledged }));
      }
      await clearAndRefresh();
    } catch (ackError) {
      toast.error(t("board.dlq.redis.ackFailed"), {
        description: formatErrorMessage(ackError),
      });
    }
  }, [checked, clearAndRefresh, confirm, connID, group, stream, t]);

  const claim = useCallback(
    async (consumer: string, guardMs: number) => {
      if (stream == null || group == null) return;
      const result =
        claiming === "auto"
          ? await redisApi.autoClaim(connID, {
              stream,
              group,
              consumer,
              minIdleMs: guardMs,
            })
          : await redisApi.claimEntries(connID, {
              stream,
              group,
              consumer,
              ids: checked,
              minIdleMs: guardMs,
            });

      if (result.claimed.length === 0) {
        /* Nothing moved, which on a guarded claim means every entry had been
           touched more recently than the guard allowed. Saying "moved 0" is
           what stops it reading as a failure of the button. */
        toast.error(t("board.dlq.redis.claim.none"));
      } else {
        toast.success(
          t("board.dlq.redis.claim.done", { count: result.claimed.length, consumer }),
        );
      }
      if (result.deleted.length > 0) {
        /* Entries that were owed and are no longer in the stream. The
           auto-claim drops them rather than moving them: that is work lost
           rather than reassigned, and this is the only moment anything says
           so. */
        toast.error(t("board.dlq.redis.claim.lost", { count: result.deleted.length }));
      }
      setClaiming(null);
      await clearAndRefresh();
    },
    [checked, claiming, clearAndRefresh, connID, group, stream, t],
  );

  const allChecked = entries.length > 0 && checked.length === entries.length;

  return (
    <Page>
      <ClaimDialog
        open={claiming != null}
        auto={claiming === "auto"}
        count={checked.length}
        onOpenChange={(open) => !open && setClaiming(null)}
        onClaim={claim}
      />
      <PageHeader
        title={t("board.dlq.redis.title")}
        subtitle={t("board.dlq.redis.subtitle")}
        actions={
          <RefreshButton
            refreshing={pending.refreshing}
            online={pending.online}
            onClick={() => void pending.refresh()}
          />
        }
      />
      <Toolbar>
        <SelectField
          value={selectedGroup ?? ""}
          options={groupRows.map((row) => ({
            value: groupKey(row),
            label: `${groupStream(row)} · ${groupName(row)}`,
          }))}
          onValueChange={(next: string) => {
            setSelectedGroup(next);
            setChecked([]);
          }}
        />
        <SelectField
          value={String(minIdleMs)}
          prefix={`${t("board.dlq.redis.idleAtLeast")}：`}
          options={THRESHOLDS.map((threshold) => ({
            value: String(threshold),
            label:
              threshold === 0
                ? t("board.dlq.redis.anyIdle")
                : formatIdle(threshold),
          }))}
          onValueChange={(next: string) => {
            setMinIdleMs(Number(next));
            setChecked([]);
          }}
        />
        <span className="flex-1" />
        <Button
          variant="outline"
          disabled={stream == null || entries.length === 0}
          onClick={() => setClaiming("auto")}
        >
          {t("board.dlq.redis.autoclaim")}
        </Button>
      </Toolbar>

      <BoardState
        state={pending}
        empty={
          entries.length === 0 ? (
            <ListArea>
              <ListPane>
                <div
                  style={{
                    padding: "24px",
                    fontSize: "11.5px",
                    color: "var(--c-muted)",
                    textAlign: "center",
                  }}
                >
                  {groupRows.length === 0
                    ? t("board.dlq.redis.noGroups")
                    : minIdleMs > 0
                      ? t("board.dlq.redis.nothingIdle")
                      : t("board.dlq.redis.nothingPending")}
                </div>
              </ListPane>
            </ListArea>
          ) : undefined
        }
      >
        <ListArea>
          <ListPane>
            {summary != null && (
              <Panel style={{ padding: "10px 14px", margin: "10px 12px 0" }}>
                <div style={{ display: "flex", gap: "18px", alignItems: "baseline" }}>
                  <span style={{ fontSize: "11.5px" }}>
                    {t("board.dlq.redis.owed", { count: formatCount(summary.count) })}
                  </span>
                  {oldestPendingId(summary) != null && (
                    <span className="mono3" style={{ ...MONO11, color: "var(--c-muted)" }}>
                      {t("board.dlq.redis.oldest")} {oldestPendingId(summary)}
                    </span>
                  )}
                  {/* One consumer holding most of it and a group that is
                      generally behind look identical in the total, and need
                      completely different things done about them. */}
                  {dominant != null && (
                    <Status tone="warn">
                      {t("board.dlq.redis.dominant", {
                        consumer: dominant.consumer,
                        count: dominant.count,
                      })}
                    </Status>
                  )}
                </div>
                {consumers.length > 0 && (
                  <div style={{ marginTop: "8px" }}>
                    <SectionLabel style={{ marginBottom: "5px" }}>
                      {t("board.dlq.redis.consumers")}
                    </SectionLabel>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      {consumers.map((consumer) => (
                        <Status key={consumer.name} tone={CONSUMER_TONE[consumerHealth(consumer)]}>
                          {consumer.name} · {consumer.pending} · {formatIdle(consumer.idleMs)}
                          {consumerInactiveMs(consumer) != null &&
                            ` · ${formatIdle(consumerInactiveMs(consumer) ?? 0)}`}
                        </Status>
                      ))}
                    </div>
                  </div>
                )}
              </Panel>
            )}

            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead style={{ width: "34px" }}>
                    <Checkbox
                      checked={allChecked}
                      aria-label={t("board.common.selectAll")}
                      onCheckedChange={() =>
                        setChecked(allChecked ? [] : entries.map((entry) => entry.id))
                      }
                    />
                  </TableHead>
                  <TableHead>Entry ID</TableHead>
                  <TableHead>consumer</TableHead>
                  <TableHead style={RIGHT}>idle</TableHead>
                  <TableHead style={RIGHT}>{t("board.dlq.redis.deliveries")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => {
                  const on = checked.includes(entry.id);
                  return (
                    <TableRow key={entry.id} selected={on}>
                      <TableCell>
                        <Checkbox
                          checked={on}
                          aria-label={entry.id}
                          onCheckedChange={() =>
                            setChecked((current) =>
                              current.includes(entry.id)
                                ? current.filter((id) => id !== entry.id)
                                : [...current, entry.id],
                            )
                          }
                        />
                      </TableCell>
                      <TableCell className="mono3" style={MONO11}>
                        {entry.id}
                      </TableCell>
                      <TableCell className="mono3" style={MONO11}>
                        {entry.consumer}
                      </TableCell>
                      <TableCell className="mono3" style={RIGHT}>
                        {formatIdle(entry.idleMs)}
                      </TableCell>
                      <TableCell
                        className="mono3"
                        style={{
                          ...RIGHT,
                          // Climbing deliveries are the closest thing Redis has
                          // to a poison message, and unlike a dead letter
                          // nothing moves it anywhere.
                          color: entry.deliveries > 3 ? "var(--c-warn-text)" : undefined,
                        }}
                      >
                        {entry.deliveries}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ListPane>
        </ListArea>
      </BoardState>

      {checked.length > 0 && (
        <BulkBar hint={t("board.dlq.redis.bulkHint")}>
          <span>{t("board.common.selectedN", { n: checked.length })}</span>
          <Button onClick={() => setClaiming("selection")}>
            {t("board.dlq.redis.claim.action")}
          </Button>
          <Button variant="outline" onClick={() => void acknowledge()}>
            XACK
          </Button>
        </BulkBar>
      )}
    </Page>
  );
}
