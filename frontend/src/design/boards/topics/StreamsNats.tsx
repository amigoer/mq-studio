import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ListArea, ListPane, Page, PageHeader, RefreshButton, Toolbar } from "@/design/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { StreamDialogNats } from "./StreamDialogNats";
import { PurgeDialogNats } from "./PurgeDialogNats";
import { useConnectionScope } from "@/mq/ConnectionScope";
import * as natsApi from "@/api/nats";
import type { PurgeInput, StreamInput } from "@/api/nats";
import { formatErrorMessage } from "@/lib/utils";
import { useNatsStreamDetail, useNatsStreams } from "@/hooks/nats/useNatsStreams";
import { formatBytes, formatCount } from "@/lib/format";
import type { Destination } from "@bindings/model/models";
import {
  allowRollup,
  bytes,
  clusterName,
  compression,
  consumerCount,
  created,
  deletedCount,
  denyDelete,
  denyPurge,
  description,
  discard,
  duplicateWindow,
  firstSequence,
  firstTime,
  lastSequence,
  lastTime,
  leader,
  maxAge,
  maxBytes,
  maxMessages,
  maxMessageSize,
  maxMessagesPerSubject,
  messages,
  mirrorOf,
  replicaLines,
  replicas,
  replicasHealthy,
  retention,
  sealed,
  sourceOf,
  storage,
  streamName,
  subjectCount,
  subjects,
} from "@/mq/nats/destinations";

const NAME = { fontSize: "11.5px" } as const;
const MONO11 = { fontSize: "11px" } as const;
const RIGHT = { textAlign: "right" } as const;

/** A figure the server did not report reads as a dash, never as a zero. */
function Metric({ value, format }: { value: number | null; format?: (value: number) => string }) {
  if (value == null) return <span style={{ color: "var(--c-muted-2)" }}>—</span>;
  return <>{format ? format(value) : formatCount(value)}</>;
}

/** A limit the server spells as -1 reads as the word, not as a number. */
function Limit({ value, format }: { value: number | null; format?: (value: number) => string }) {
  const { t } = useTranslation();
  if (value == null) {
    return <span style={{ color: "var(--c-muted-2)" }}>{t("board.topics.nats.unlimited")}</span>;
  }
  return <>{format ? format(value) : formatCount(value)}</>;
}

/**
 * NATS streams.
 *
 * A stream is what an account has asked the server to keep, and it is the only
 * thing here that can be listed at all: a subject is a routing label with no
 * existence of its own, nothing declares one, and there is no way to enumerate
 * the ones nobody is using.
 *
 * The replica column is the reason this board is not the Redis one with
 * different words. A JetStream stream on a cluster has a leader and a set of
 * followers that can fall behind independently, and "2 of 3 current" is the
 * figure an operator opens this page for. A stream on a single server reports
 * no cluster at all, and that shows as a dash rather than as "1 of 1" - it is
 * not a healthy stream, it is an unprotected one, and those want different
 * things from whoever is reading.
 */
export function StreamsNats() {
  const { t } = useTranslation();
  const state = useNatsStreams();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Destination | null>(null);
  const [purging, setPurging] = useState<string | null>(null);

  const streams = useMemo(() => state.data ?? [], [state.data]);
  const detail = useNatsStreamDetail(selected);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return streams
      .filter((stream) => {
        if (needle === "") return true;
        // Matching subjects as well as the name, because that is how people
        // look for a stream: they know what is published, not what somebody
        // called the thing that keeps it.
        return (
          streamName(stream).toLowerCase().includes(needle) ||
          subjects(stream).some((subject) => subject.toLowerCase().includes(needle))
        );
      })
      .sort((left, right) => messages(right) - messages(left));
  }, [search, streams]);

  /* The detail call is what carries the per-subject counts, so the panel
     prefers it and falls back to the row while it is in flight. */
  const panel = useMemo(() => {
    if (selected == null) return null;
    return detail.data ?? streams.find((stream) => streamName(stream) === selected) ?? null;
  }, [detail.data, selected, streams]);

  const save = useCallback(
    async (input: StreamInput, update: boolean) => {
      if (update) {
        await natsApi.updateStream(connID, input);
        toast.success(t("board.topics.nats.streamUpdated", { name: input.name }));
      } else {
        await natsApi.createStream(connID, input);
        toast.success(t("board.topics.nats.streamCreated", { name: input.name }));
      }
      await state.refresh();
    },
    [connID, state, t],
  );

  const purge = useCallback(
    async (input: PurgeInput) => {
      const { removed } = await natsApi.purgeStream(connID, input);
      /* The count is the whole report. A bound that already held and one that
         matched nothing both remove zero, and only saying the number lets the
         reader tell which happened. */
      toast.success(t("board.topics.nats.purged", { count: removed }));
      await state.refresh();
    },
    [connID, state, t],
  );

  const remove = useCallback(
    async (stream: Destination) => {
      const held = messages(stream);
      const bound = consumerCount(stream);
      const ok = await confirm({
        title: t("board.topics.nats.deleteTitle", { name: streamName(stream) }),
        /* The counts are the whole warning. Deleting a stream takes every
           message in it and every consumer's position with them, and JetStream
           has no undo and no delete-if-empty to fall back on. */
        description:
          held > 0 || bound > 0
            ? t("board.topics.nats.deleteHolding", { count: held, consumers: bound })
            : t("board.topics.nats.deleteEmpty"),
        confirmLabel: t("board.common.delete"),
        danger: true,
      });
      if (!ok) return;
      try {
        await natsApi.deleteStream(connID, streamName(stream));
        toast.success(t("board.topics.nats.streamDeleted", { name: streamName(stream) }));
        setSelected(null);
        await state.refresh();
      } catch (deleteError) {
        toast.error(t("board.topics.nats.deleteFailed"), {
          description: formatErrorMessage(deleteError),
        });
      }
    },
    [confirm, connID, state, t],
  );

  return (
    <Page>
      <PurgeDialogNats
        stream={purging}
        open={purging != null}
        onOpenChange={(open) => !open && setPurging(null)}
        onPurge={purge}
      />
      <StreamDialogNats
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditing(null);
        }}
        editing={editing}
        onSubmit={save}
      />
      <PageHeader
        title={t("board.topics.nats.title")}
        subtitle={t("board.topics.nats.subtitle")}
        actions={
          <>
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              {t("board.topics.nats.newStream")}
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
          className="w-[240px] flex-none"
          placeholder={t("board.topics.nats.search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <span className="flex-1" />
        <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>
          {t("board.topics.nats.found", { count: rows.length })}
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
                    ? t("board.topics.nats.noStreams")
                    : t("board.topics.nats.noMatches")}
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
                  <TableHead>{t("board.topics.nats.stream")}</TableHead>
                  <TableHead>{t("board.topics.nats.subjects")}</TableHead>
                  <TableHead style={RIGHT}>{t("board.topics.nats.messages")}</TableHead>
                  <TableHead style={RIGHT}>{t("board.topics.nats.size")}</TableHead>
                  <TableHead style={RIGHT}>{t("board.topics.nats.consumers")}</TableHead>
                  <TableHead>{t("board.topics.nats.retention")}</TableHead>
                  <TableHead>{t("board.topics.nats.replicas")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((stream) => {
                  const name = streamName(stream);
                  return (
                    <TableRow
                      key={name}
                      selected={selected === name}
                      onClick={() => setSelected(name)}
                    >
                      <TableCell>
                        <b className="mono3" style={{ fontWeight: 500, ...NAME }}>
                          {name}
                        </b>
                      </TableCell>
                      <TableCell className="mono3" style={MONO11}>
                        <SubjectList stream={stream} />
                      </TableCell>
                      <TableCell className="mono3" style={RIGHT}>
                        {formatCount(messages(stream))}
                      </TableCell>
                      <TableCell className="mono3" style={RIGHT}>
                        <Metric value={bytes(stream)} format={formatBytes} />
                      </TableCell>
                      <TableCell className="mono3" style={RIGHT}>
                        {consumerCount(stream)}
                      </TableCell>
                      <TableCell style={MONO11}>
                        <RetentionBadge stream={stream} />
                      </TableCell>
                      <TableCell className="mono3" style={MONO11}>
                        <ReplicaSummary stream={stream} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ListPane>

          {panel != null && (
            <DetailPanel width={400} onDismiss={() => setSelected(null)}>
              <DetailPanelHeader
                title={streamName(panel)}
                badge={
                  <Status tone={sealed(panel) ? "warn" : "off"} style={{ fontSize: "10px" }}>
                    {sealed(panel) ? t("board.topics.nats.sealed") : (storage(panel) ?? "stream")}
                  </Status>
                }
                onClose={() => setSelected(null)}
              />
              <DetailPanelBody>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  <Panel style={{ padding: "9px 12px" }}>
                    <div style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>
                      {t("board.topics.nats.messages")}
                    </div>
                    <div
                      className="mono3"
                      style={{ fontSize: "15px", fontWeight: 600, marginTop: "2px" }}
                    >
                      {formatCount(messages(panel))}
                    </div>
                  </Panel>
                  <Panel style={{ padding: "9px 12px" }}>
                    <div style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>
                      {t("board.topics.nats.size")}
                    </div>
                    <div
                      className="mono3"
                      style={{ fontSize: "15px", fontWeight: 600, marginTop: "2px" }}
                    >
                      <Metric value={bytes(panel)} format={formatBytes} />
                    </div>
                  </Panel>
                </div>

                {description(panel) != null && (
                  <div style={{ fontSize: "11.5px", color: "var(--c-muted)" }}>
                    {description(panel)}
                  </div>
                )}

                <div>
                  <SectionLabel style={{ marginBottom: "6px" }}>
                    {t("board.topics.nats.subjects")}
                  </SectionLabel>
                  {subjects(panel).length === 0 ? (
                    <div style={{ fontSize: "11px", color: "var(--c-muted)" }}>
                      {/* A mirror takes its messages from another stream rather
                          than from the subject space, so no subjects is a fact
                          about the stream and not a field that failed to load. */}
                      {mirrorOf(panel) != null
                        ? t("board.topics.nats.mirrorHasNoSubjects", { stream: mirrorOf(panel) })
                        : "—"}
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                      {subjects(panel).map((subject) => (
                        <Status key={subject} tone="off" style={{ fontSize: "10px" }}>
                          {subject}
                        </Status>
                      ))}
                    </div>
                  )}
                </div>

                <KV
                  rows={[
                    [t("board.topics.nats.retention"), text(retention(panel))],
                    [t("board.topics.nats.storage"), text(storage(panel))],
                    [t("board.topics.nats.discard"), text(discard(panel))],
                    [t("board.topics.nats.compression"), text(compression(panel))],
                    [
                      t("board.topics.nats.sequences"),
                      <span className="mono3" style={MONO11}>
                        {firstSequence(panel) == null || lastSequence(panel) == null ? (
                          "—"
                        ) : (
                          <>
                            {formatCount(firstSequence(panel) ?? 0)} …{" "}
                            {formatCount(lastSequence(panel) ?? 0)}
                          </>
                        )}
                      </span>,
                    ],
                    [
                      t("board.topics.nats.subjectCount"),
                      <span className="mono3" style={MONO11}>
                        <Metric value={subjectCount(panel)} />
                      </span>,
                    ],
                    [
                      t("board.topics.nats.deleted"),
                      <span className="mono3" style={MONO11}>
                        <Metric value={deletedCount(panel)} />
                      </span>,
                    ],
                    [t("board.topics.nats.created"), text(created(panel))],
                    [
                      t("board.topics.nats.window"),
                      <span className="mono3" style={MONO11}>
                        {/* Absent means the stream holds nothing, which is a
                            different fact from a window of no length. */}
                        {firstTime(panel) == null || lastTime(panel) == null ? (
                          <span style={{ color: "var(--c-muted-2)" }}>
                            {t("board.topics.nats.empty")}
                          </span>
                        ) : (
                          <>
                            {firstTime(panel)} → {lastTime(panel)}
                          </>
                        )}
                      </span>,
                    ],
                  ]}
                />

                <div>
                  <SectionLabel style={{ marginBottom: "6px" }}>
                    {t("board.topics.nats.limits")}
                  </SectionLabel>
                  <KV
                    rows={[
                      [
                        t("board.topics.nats.maxMessages"),
                        <span className="mono3" style={MONO11}>
                          <Limit value={maxMessages(panel)} />
                        </span>,
                      ],
                      [
                        t("board.topics.nats.maxBytes"),
                        <span className="mono3" style={MONO11}>
                          <Limit value={maxBytes(panel)} format={formatBytes} />
                        </span>,
                      ],
                      [
                        t("board.topics.nats.maxPerSubject"),
                        <span className="mono3" style={MONO11}>
                          <Limit value={maxMessagesPerSubject(panel)} />
                        </span>,
                      ],
                      [
                        t("board.topics.nats.maxMessageSize"),
                        <span className="mono3" style={MONO11}>
                          <Limit value={maxMessageSize(panel)} format={formatBytes} />
                        </span>,
                      ],
                      [
                        t("board.topics.nats.maxAge"),
                        <span className="mono3" style={MONO11}>
                          {maxAge(panel) ?? (
                            <span style={{ color: "var(--c-muted-2)" }}>
                              {t("board.topics.nats.unlimited")}
                            </span>
                          )}
                        </span>,
                      ],
                      [
                        t("board.topics.nats.duplicates"),
                        <span className="mono3" style={MONO11}>
                          {duplicateWindow(panel) ?? "—"}
                        </span>,
                      ],
                    ]}
                  />
                </div>

                <div>
                  <SectionLabel style={{ marginBottom: "6px" }}>
                    {t("board.topics.nats.placement")}
                  </SectionLabel>
                  {clusterName(panel) == null ? (
                    <div style={{ fontSize: "11px", color: "var(--c-muted)" }}>
                      {/* Not "1 of 1 replicas": an unreplicated stream is not a
                          healthy one, it is one with no second copy at all. */}
                      {t("board.topics.nats.notReplicated")}
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                      {replicaLines(panel).map((line) => (
                        <span key={line} className="mono3" style={MONO11}>
                          {line}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <Flags panel={panel} />

                {sourceOf(panel) != null && (
                  <div style={{ fontSize: "11px", color: "var(--c-muted)" }}>
                    {t("board.topics.nats.sourcedFrom", { streams: sourceOf(panel) })}
                  </div>
                )}
              </DetailPanelBody>
              <DetailPanelFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditing(panel);
                    setDialogOpen(true);
                  }}
                >
                  {t("board.common.edit")}
                </Button>
                {/* Sealed and deny-delete are the server's own protections, and
                    a button that was going to be refused is worse than one that
                    is not there: the reason belongs beside it, not in a toast
                    after the click. */}
                {/* Purge and delete are disabled by different settings, so
                    each gates on its own: a stream may refuse purges and still
                    allow being deleted outright. */}
                <Button
                  variant="outline"
                  disabled={sealed(panel) || denyPurge(panel)}
                  onClick={() => setPurging(streamName(panel))}
                >
                  {t("board.topics.nats.purge")}
                </Button>
                <Button
                  variant="destructive"
                  disabled={sealed(panel) || denyDelete(panel)}
                  onClick={() => void remove(panel)}
                >
                  {t("board.common.delete")}
                </Button>
              </DetailPanelFooter>
            </DetailPanel>
          )}
        </ListArea>
      </BoardState>
    </Page>
  );
}

function text(value: string | null) {
  return (
    <span className="mono3" style={MONO11}>
      {value ?? "—"}
    </span>
  );
}

/**
 * The subjects, truncated.
 *
 * A stream can capture dozens, and a row that grew to fit them would push
 * every figure beside it off screen. The count says how many were not shown so
 * the truncation is visible rather than silent.
 */
function SubjectList({ stream }: { stream: Parameters<typeof subjects>[0] }) {
  const { t } = useTranslation();
  const all = subjects(stream);
  if (all.length === 0) {
    const mirror = mirrorOf(stream);
    return (
      <span style={{ color: "var(--c-muted-2)" }}>
        {mirror != null ? t("board.topics.nats.mirrorOf", { stream: mirror }) : "—"}
      </span>
    );
  }
  const shown = all.slice(0, 2);
  return (
    <>
      {shown.join(", ")}
      {all.length > shown.length && (
        <span style={{ color: "var(--c-muted)" }}>
          {" "}
          {t("board.topics.nats.moreSubjects", { count: all.length - shown.length })}
        </span>
      )}
    </>
  );
}

/**
 * The retention policy, with the destructive one marked.
 *
 * A work queue is the only setting under which reading the stream changes what
 * it holds - each message goes as soon as one consumer acknowledges it - and
 * somebody about to attach a second consumer needs to know that before they do
 * it, not afterwards.
 */
function RetentionBadge({ stream }: { stream: Parameters<typeof retention>[0] }) {
  const policy = retention(stream);
  if (policy == null) return <span style={{ color: "var(--c-muted-2)" }}>—</span>;
  return (
    <Status tone={policy === "workqueue" ? "warn" : "off"} style={{ fontSize: "10px" }}>
      {policy}
    </Status>
  );
}

/**
 * How many copies are keeping up.
 *
 * A dash where the stream is not replicated, and a warning tone where a peer
 * has fallen behind or gone offline. Those are three states and they must not
 * collapse into two: unreplicated is not unhealthy, it is unprotected.
 */
function ReplicaSummary({ stream }: { stream: Parameters<typeof replicas>[0] }) {
  const total = replicas(stream);
  const healthy = replicasHealthy(stream);
  if (total == null || total <= 1 || healthy == null) {
    return <span style={{ color: "var(--c-muted-2)" }}>—</span>;
  }
  return (
    <Status tone={healthy ? "ok" : "warn"} style={{ fontSize: "10px" }}>
      {leader(stream) ?? "?"} +{total - 1}
    </Status>
  );
}

/**
 * The settings that change what an operator may do to the stream.
 *
 * Only the ones that are on are drawn. A row of "false" for every flag on
 * every stream is noise, and the whole point of these is that they are
 * exceptions.
 */
function Flags({ panel }: { panel: Parameters<typeof sealed>[0] }) {
  const { t } = useTranslation();
  const flags = [
    sealed(panel) ? t("board.topics.nats.flagSealed") : null,
    denyDelete(panel) ? t("board.topics.nats.flagDenyDelete") : null,
    denyPurge(panel) ? t("board.topics.nats.flagDenyPurge") : null,
    allowRollup(panel) ? t("board.topics.nats.flagAllowRollup") : null,
  ].filter((flag): flag is string => flag != null);

  if (flags.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
      {flags.map((flag) => (
        <Status key={flag} tone="warn" style={{ fontSize: "10px" }}>
          {flag}
        </Status>
      ))}
    </div>
  );
}
