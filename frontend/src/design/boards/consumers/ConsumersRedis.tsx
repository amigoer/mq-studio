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
import { Status, toast, useConfirm } from "@/components";
import { BoardState } from "@/design/boards/BoardState";
import { GroupDialog } from "./GroupDialog";
import { useRedisGroups } from "@/hooks/redis/useRedisGroups";
import { useRedisStreams } from "@/hooks/redis/useRedisStreams";
import { useConnectionScope } from "@/mq/ConnectionScope";
import * as redisApi from "@/api/redis";
import type { GroupStart } from "@/api/redis";
import { formatCount } from "@/lib/format";
import { formatErrorMessage } from "@/lib/utils";
import {
  consumerCount,
  entriesRead,
  groupKey,
  groupName,
  groupStream,
  health,
  lag,
  lastDeliveredId,
  pending,
  type GroupHealth,
} from "@/mq/redis/subscriptions";
import { streamKey } from "@/mq/redis/destinations";

const MONO11 = { fontSize: "11px" } as const;
const RIGHT = { textAlign: "right" } as const;

/** A figure the broker did not report reads as a dash, never as a zero. */
function Metric({ value }: { value: number | null }) {
  if (value == null) return <span style={{ color: "var(--c-muted-2)" }}>—</span>;
  return <>{formatCount(value)}</>;
}

const TONE: Record<GroupHealth, "ok" | "warn" | "off"> = {
  consuming: "ok",
  stalled: "warn",
  idle: "off",
};

/**
 * Board 14c — Redis consumer groups.
 *
 * A group belongs to one stream and its name is unique only within it, so the
 * stream is a column rather than a detail: two rows called "settle-group" on
 * different streams are unrelated objects, and a table showing the name alone
 * would look like it had a duplicate.
 *
 * The canvas put the selected group's pending entries below this table, which
 * is the right place for them. They arrive with the port that reads them.
 */
export function ConsumersRedis() {
  const { t } = useTranslation();
  const state = useRedisGroups();
  /* Only to offer the streams a new group can be declared on, so it shares
     the read the stream board already does. */
  const streams = useRedisStreams();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [stalledOnly, setStalledOnly] = useState(false);
  const [declaring, setDeclaring] = useState(false);

  const groups = useMemo(() => state.data ?? [], [state.data]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return groups
      .filter((group) => {
        if (stalledOnly && health(group) !== "stalled") return false;
        if (needle === "") return true;
        return (
          groupName(group).toLowerCase().includes(needle) ||
          groupStream(group).toLowerCase().includes(needle)
        );
      })
      .sort((left, right) => (pending(right) ?? 0) - (pending(left) ?? 0));
  }, [groups, search, stalledOnly]);

  const streamKeys = useMemo(
    () => (streams.data ?? []).map((stream) => streamKey(stream)).sort(),
    [streams.data],
  );

  const create = useCallback(
    async (stream: string, group: string, start: GroupStart) => {
      await redisApi.createGroup(connID, stream, group, start);
      toast.success(t("board.consumers.redis.created", { name: group }));
      await state.refresh();
    },
    [connID, state, t],
  );

  const remove = useCallback(
    async (stream: string, group: string, held: number | null) => {
      const ok = await confirm({
        title: t("board.consumers.redis.deleteTitle", { name: group }),
        /* The pending count is the whole warning. Destroying a group discards
           what it was still holding: those entries stay in the stream but stop
           being owed to anyone, which is not the same as being delivered. */
        description:
          (held ?? 0) > 0
            ? t("board.consumers.redis.deletePending", { count: held ?? 0 })
            : t("board.consumers.redis.deleteEmpty"),
        confirmLabel: t("board.common.delete"),
        danger: true,
      });
      if (!ok) return;
      try {
        await redisApi.deleteGroup(connID, stream, group);
        toast.success(t("board.consumers.redis.deleted", { name: group }));
        await state.refresh();
      } catch (deleteError) {
        toast.error(t("board.consumers.redis.deleteFailed"), {
          description: formatErrorMessage(deleteError),
        });
      }
    },
    [confirm, connID, state, t],
  );

  return (
    <Page>
      <GroupDialog
        open={declaring}
        streams={streamKeys}
        onOpenChange={setDeclaring}
        onCreate={create}
      />
      <PageHeader
        title={t("board.common.consumerGroup")}
        subtitle={t("board.consumers.redis.subtitle")}
        actions={
          <>
            <Button disabled={streamKeys.length === 0} onClick={() => setDeclaring(true)}>
              {t("board.consumers.redis.newGroup")}
            </Button>
            <RefreshButton
              refreshing={state.refreshing}
              online={state.online}
              onClick={() => void state.refresh()}
            />
          </>
        }
      />
      <Toolbar>
        <Input
          className="w-[220px] flex-none"
          placeholder={t("board.consumers.redis.search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "11.5px",
            color: "var(--c-mono-dim)",
          }}
        >
          <Switch checked={stalledOnly} onCheckedChange={setStalledOnly} />
          {t("board.consumers.redis.stalledOnly")}
        </span>
        <span className="flex-1" />
        <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>
          {t("board.consumers.redis.found", { count: rows.length })}
        </span>
      </Toolbar>

      <BoardState
        state={state}
        empty={
          rows.length === 0 ? (
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
                  {groups.length === 0
                    ? t("board.consumers.redis.noGroups")
                    : t("board.consumers.redis.noMatches")}
                </div>
              </ListPane>
            </ListArea>
          ) : undefined
        }
      >
        <ListArea>
          <ListPane>
            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("board.common.group")}</TableHead>
                  <TableHead>Stream</TableHead>
                  <TableHead style={RIGHT}>consumers</TableHead>
                  <TableHead style={RIGHT}>pending</TableHead>
                  <TableHead>last-delivered-id</TableHead>
                  <TableHead style={RIGHT}>entries-read</TableHead>
                  <TableHead style={RIGHT}>{t("board.consumers.redis.lag")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((group) => {
                  const condition = health(group);
                  const held = pending(group);
                  return (
                    <TableRow key={groupKey(group)}>
                      <TableCell>
                        <b className="mono3" style={{ fontWeight: 500, fontSize: "11.5px" }}>
                          {groupName(group)}
                        </b>
                      </TableCell>
                      <TableCell className="mono3" style={MONO11}>
                        {groupStream(group)}
                      </TableCell>
                      <TableCell className="mono3" style={RIGHT}>
                        <Status tone={TONE[condition]}>
                          {consumerCount(group)} · {t(`board.consumers.redis.health.${condition}`)}
                        </Status>
                      </TableCell>
                      <TableCell className="mono3" style={RIGHT}>
                        <Metric value={held} />
                      </TableCell>
                      <TableCell className="mono3" style={MONO11}>
                        {lastDeliveredId(group) ?? "—"}
                      </TableCell>
                      <TableCell className="mono3" style={RIGHT}>
                        <Metric value={entriesRead(group)} />
                      </TableCell>
                      <TableCell className="mono3" style={RIGHT}>
                        {/* Null is not zero. Redis stops being able to count
                            the lag once entries a group had not read are
                            deleted, and a zero there would report a group that
                            is arbitrarily far behind as caught up. */}
                        <Metric value={lag(group)} />
                      </TableCell>
                      <TableCell style={RIGHT}>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => void remove(groupStream(group), groupName(group), held)}
                        >
                          {t("board.common.delete")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ListPane>
        </ListArea>
      </BoardState>
    </Page>
  );
}
