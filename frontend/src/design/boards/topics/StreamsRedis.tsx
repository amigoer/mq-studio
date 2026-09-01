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
  SectionLabel,
  Status,
  toast,
  useConfirm,
} from "@/components";
import { BoardState } from "@/design/boards/BoardState";
import { StreamDialog } from "./StreamDialog";
import { TrimDialog } from "./TrimDialog";
import { useConnectionScope } from "@/mq/ConnectionScope";
import * as redisApi from "@/api/redis";
import type { TrimRequest } from "@/api/redis";
import { formatErrorMessage } from "@/lib/utils";
import { useRedisStreamDetail, useRedisStreams } from "@/hooks/redis/useRedisStreams";
import { formatBytes, formatCount } from "@/lib/format";
import {
  entriesAdded,
  firstEntryId,
  groupCount,
  groupNames,
  lastEntryId,
  lastGeneratedId,
  length,
  maxDeletedEntryId,
  memoryBytes,
  radixTreeKeys,
  radixTreeNodes,
  streamKey,
  trimmedAway,
} from "@/mq/redis/destinations";

const NAME = { fontSize: "11.5px" } as const;
const MONO11 = { fontSize: "11px" } as const;
const RIGHT = { textAlign: "right" } as const;

/** A figure the broker did not report reads as a dash, never as a zero. */
function Metric({ value, format }: { value: number | null; format?: (value: number) => string }) {
  if (value == null) return <span style={{ color: "var(--c-muted-2)" }}>—</span>;
  return <>{format ? format(value) : formatCount(value)}</>;
}

/**
 * Board 12b — Redis streams.
 *
 * The list is a SCAN with TYPE stream, narrowed by the key pattern on the
 * connection. That is why the header says how many it found rather than how
 * many there are: SCAN is a cursor rather than a snapshot, and the driver caps
 * the walk so a keyspace of millions cannot hold the page open.
 *
 * The canvas drew a maxlen column and an XTRIM button. The column is gone -
 * Redis stores no per-stream maxlen, so every value in it would have been
 * invented - and XTRIM arrives with the write operations, because a control
 * that does nothing is worse than one that is not there.
 */
export function StreamsRedis() {
  const { t } = useTranslation();
  const state = useRedisStreams();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [withGroupsOnly, setWithGroupsOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [trimming, setTrimming] = useState<string | null>(null);

  const streams = useMemo(() => state.data ?? [], [state.data]);
  const detail = useRedisStreamDetail(selected);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return streams
      .filter((stream) => {
        if (withGroupsOnly && groupCount(stream) === 0) return false;
        return needle === "" || streamKey(stream).toLowerCase().includes(needle);
      })
      .sort((left, right) => length(right) - length(left));
  }, [search, streams, withGroupsOnly]);

  /* The detail call is what names the groups, so the panel prefers it and
     falls back to the row while it is in flight. */
  const panel = useMemo(() => {
    if (selected == null) return null;
    return detail.data ?? streams.find((stream) => streamKey(stream) === selected) ?? null;
  }, [detail.data, selected, streams]);

  const create = useCallback(
    async (key: string) => {
      await redisApi.createStream(connID, key);
      toast.success(t("board.topics.redis.created", { name: key }));
      await state.refresh();
    },
    [connID, state, t],
  );

  const trim = useCallback(
    async (request: TrimRequest) => {
      const { removed } = await redisApi.trimStream(connID, request);
      /* The count is the report, not a formality. An approximate trim keeps at
         least what was asked and may keep more, so "removed 0" is the only way
         to tell a boundary the server would not split from a bound that
         matched nothing at all. */
      toast.success(t("board.topics.redis.trim.done", { count: removed }));
      await state.refresh();
    },
    [connID, state, t],
  );

  const remove = useCallback(
    async (key: string, holding: number, groups: number) => {
      const ok = await confirm({
        title: t("board.topics.redis.deleteTitle", { name: key }),
        /* The counts are the whole warning. DEL takes the entries and every
           consumer group's position with them, and Redis offers no undo and no
           delete-if-empty to fall back on. */
        description:
          holding > 0 || groups > 0
            ? t("board.topics.redis.deleteHolding", { count: holding, groups })
            : t("board.topics.redis.deleteEmpty"),
        confirmLabel: t("board.common.delete"),
        danger: true,
      });
      if (!ok) return;
      try {
        await redisApi.deleteStream(connID, key);
        toast.success(t("board.topics.redis.deleted", { name: key }));
        setSelected(null);
        await state.refresh();
      } catch (deleteError) {
        toast.error(t("board.topics.redis.deleteFailed"), {
          description: formatErrorMessage(deleteError),
        });
      }
    },
    [confirm, connID, state, t],
  );

  return (
    <Page>
      <StreamDialog open={creating} onOpenChange={setCreating} onCreate={create} />
      <TrimDialog
        stream={trimming}
        open={trimming != null}
        onOpenChange={(open) => !open && setTrimming(null)}
        onTrim={trim}
      />
      <PageHeader
        title="Stream"
        subtitle={t("board.topics.redis.subtitle")}
        actions={
          <>
            <Button onClick={() => setCreating(true)}>
              {t("board.topics.redis.newStream")}
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
          className="w-[200px] flex-none"
          placeholder={t("board.topics.redis.searchKey")}
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
          <Switch checked={withGroupsOnly} onCheckedChange={setWithGroupsOnly} />
          {t("board.topics.redis.withGroupsOnly")}
        </span>
        <span className="flex-1" />
        <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>
          {t("board.topics.redis.found", { count: rows.length })}
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
                  {streams.length === 0
                    ? t("board.topics.redis.noStreams")
                    : t("board.topics.redis.noMatches")}
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
                  <TableHead>Stream Key</TableHead>
                  <TableHead style={RIGHT}>XLEN</TableHead>
                  <TableHead style={RIGHT}>{t("board.common.group")}</TableHead>
                  <TableHead>last-generated-id</TableHead>
                  <TableHead style={RIGHT}>{t("board.common.memory")}</TableHead>
                  <TableHead style={RIGHT}>{t("board.topics.redis.trimmed")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((stream) => {
                  const key = streamKey(stream);
                  return (
                    <TableRow
                      key={key}
                      selected={selected === key}
                      onClick={() => setSelected(key)}
                    >
                      <TableCell>
                        <b className="mono3" style={{ fontWeight: 500, ...NAME }}>
                          {key}
                        </b>
                      </TableCell>
                      <TableCell className="mono3" style={RIGHT}>
                        {formatCount(length(stream))}
                      </TableCell>
                      <TableCell className="mono3" style={RIGHT}>
                        {groupCount(stream)}
                      </TableCell>
                      <TableCell className="mono3" style={MONO11}>
                        {lastGeneratedId(stream) ?? "—"}
                      </TableCell>
                      <TableCell className="mono3" style={RIGHT}>
                        <Metric value={memoryBytes(stream)} format={formatBytes} />
                      </TableCell>
                      <TableCell className="mono3" style={RIGHT}>
                        <Metric value={trimmedAway(stream)} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ListPane>

          {panel != null && (
            <DetailPanel width={390} onDismiss={() => setSelected(null)}>
              <DetailPanelHeader
                title={streamKey(panel)}
                badge={
                  <Status tone="off" style={{ fontSize: "10px" }}>
                    stream
                  </Status>
                }
                onClose={() => setSelected(null)}
              />
              <DetailPanelBody>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  <Panel style={{ padding: "9px 12px" }}>
                    <div style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>XLEN</div>
                    <div
                      className="mono3"
                      style={{ fontSize: "15px", fontWeight: 600, marginTop: "2px" }}
                    >
                      {formatCount(length(panel))}
                    </div>
                  </Panel>
                  <Panel style={{ padding: "9px 12px" }}>
                    <div style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>
                      {t("board.topics.redis.entriesAdded")}
                    </div>
                    <div
                      className="mono3"
                      style={{ fontSize: "15px", fontWeight: 600, marginTop: "2px" }}
                    >
                      <Metric value={entriesAdded(panel)} />
                    </div>
                  </Panel>
                </div>

                <KV
                  rows={[
                    [
                      "first-entry",
                      <span className="mono3" style={MONO11}>
                        {firstEntryId(panel) ?? "—"}
                      </span>,
                    ],
                    [
                      "last-entry",
                      <span className="mono3" style={MONO11}>
                        {lastEntryId(panel) ?? "—"}
                      </span>,
                    ],
                    [
                      "max-deleted-entry-id",
                      <span className="mono3" style={MONO11}>
                        {/* Absent means nothing has ever been deleted, which
                            is a different fact from an id of zero. */}
                        {maxDeletedEntryId(panel) ?? t("board.topics.redis.nothingDeleted")}
                      </span>,
                    ],
                    [
                      "radix-tree",
                      <span className="mono3" style={MONO11}>
                        {radixTreeKeys(panel) == null || radixTreeNodes(panel) == null ? (
                          "—"
                        ) : (
                          <>
                            keys {formatCount(radixTreeKeys(panel) ?? 0)} · nodes{" "}
                            {formatCount(radixTreeNodes(panel) ?? 0)}
                          </>
                        )}
                      </span>,
                    ],
                    [
                      t("board.common.memory"),
                      <span className="mono3" style={MONO11}>
                        <Metric value={memoryBytes(panel)} format={formatBytes} />
                      </span>,
                    ],
                  ]}
                />

                <div>
                  <SectionLabel style={{ marginBottom: "6px" }}>
                    {t("board.common.consumerGroup")}
                  </SectionLabel>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {groupNames(panel).length === 0 ? (
                      <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>
                        {detail.loading
                          ? t("board.state.loading")
                          : t("board.topics.redis.noGroups")}
                      </span>
                    ) : (
                      groupNames(panel).map((name) => (
                        <Status key={name} tone="ok">
                          {name}
                        </Status>
                      ))
                    )}
                  </div>
                </div>
              </DetailPanelBody>
              <DetailPanelFooter>
                <Button variant="outline" onClick={() => setTrimming(streamKey(panel))}>
                  XTRIM…
                </Button>
                <span className="flex-1" />
                <Button
                  variant="destructive"
                  onClick={() =>
                    void remove(streamKey(panel), length(panel), groupCount(panel))
                  }
                >
                  {t("board.topics.redis.deleteKey")}
                </Button>
              </DetailPanelFooter>
            </DetailPanel>
          )}
        </ListArea>
      </BoardState>
    </Page>
  );
}
