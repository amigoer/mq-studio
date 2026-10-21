import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import {
  ListArea,
  ListPane,
  Page,
  PageHeader,
  RefreshButton,
  StatusBar,
  Toolbar,
} from "@/design/shell";
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
  MiniStat,
  OutlineTag,
  SectionLabel,
  Status,
  useConfirm,
} from "@/components";
import { BoardState, isBlocked } from "@/design/boards/BoardState";
import { useKinesisDestinations } from "@/hooks/kinesis/useKinesisDestinations";
import {
  retention,
  settling,
  stream as readStream,
  type KinesisStream,
} from "@/mq/kinesis/destinations";
import { formatCount } from "@/lib/format";
import { formatMessageTime } from "@/lib/time";
import { formatErrorMessage } from "@/lib/utils";
import { useConnectionScope } from "@/mq/ConnectionScope";
import * as kinesisApi from "@/api/kinesis";
import { StreamDialogKinesis } from "./StreamDialogKinesis";

/** A dash, not a zero: an absent figure and a measured zero are not alike. */
const DASH = "—";

function count(value: number | null): string {
  return value == null ? DASH : formatCount(value);
}

/**
 * Amazon Kinesis data streams.
 *
 * One row per stream in the region, narrowed by the connection's prefix. The
 * shard count is here and the shards are not: a count is a true thing to say
 * about a stream, and everything that makes a shard worth looking at - its id,
 * the slice of the hash space it owns, the parent it was split from - needs a
 * table of its own, which is the shards page.
 *
 * There is no depth column, and that is the service rather than this board.
 * Kinesis keeps no count of what a stream is holding; the only way to produce
 * one would be to read every shard end to end, which would spend the read
 * quota of every shard on the board to show a figure that was stale on
 * arrival. There is no rate column either - those are CloudWatch's.
 */
export function StreamsKinesis() {
  const { t } = useTranslation();
  const state = useKinesisDestinations();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<KinesisStream | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const streams = useMemo(() => (state.data ?? []).map(readStream), [state.data]);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return streams.filter((entry) => needle === "" || entry.name.toLowerCase().includes(needle));
  }, [streams, search]);

  const current = shown.find((entry) => entry.name === selected) ?? null;

  const save = useCallback(
    async (input: kinesisApi.KinesisStreamInput) => {
      if (editing == null) {
        await kinesisApi.createStream(connID, input);
        toast.success(t("board.kinesis.streams.created", { name: input.name }));
      } else {
        await kinesisApi.updateStream(connID, input);
        toast.success(t("board.kinesis.streams.updated", { name: input.name }));
      }
      await state.refresh();
    },
    [connID, editing, state, t],
  );

  /*
   * The confirmation says what a delete takes rather than only what it is
   * called. A stream's records go with it whether or not anything read them,
   * and there is no undo - the name can be reused, but the data cannot be
   * recovered from anywhere in the service.
   */
  const remove = useCallback(
    async (entry: KinesisStream) => {
      const ok = await confirm({
        title: t("board.kinesis.streams.deleteTitle", { name: entry.name }),
        description: t("board.kinesis.streams.deleteDesc", { count: entry.openShards ?? 0 }),
        confirmLabel: t("common.delete"),
        danger: true,
      });
      if (!ok) return;
      try {
        await kinesisApi.removeStream(connID, entry.name);
        toast.success(t("board.kinesis.streams.deleted", { name: entry.name }));
        setSelected(null);
        await state.refresh();
      } catch (deleteError) {
        toast.error(t("board.kinesis.streams.deleteFailed"), {
          description: formatErrorMessage(deleteError),
        });
      }
    },
    [confirm, connID, state, t],
  );

  return (
    <Page>
      <PageHeader
        title={t("shell.nav.kinesis.topics")}
        subtitle={t("board.kinesis.streams.count", { count: streams.length })}
        actions={
          <>
            <RefreshButton
              refreshing={state.refreshing}
              online={state.online}
              onClick={() => void state.refresh()}
            />
            <Button
              disabled={!state.online}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus aria-hidden />
              {t("board.kinesis.streams.create")}
            </Button>
          </>
        }
      />
      <Toolbar>
        <Input
          className="w-60 flex-none"
          value={search}
          placeholder={t("board.kinesis.streams.search")}
          onChange={(event) => setSearch(event.target.value)}
        />
      </Toolbar>
      <StreamDialogKinesis
        open={formOpen}
        editing={editing}
        onOpenChange={setFormOpen}
        onSubmit={save}
      />
      {isBlocked(state) ? (
        <BoardState state={state} />
      ) : (
        <ListArea>
          <ListPane>
            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("board.kinesis.streams.name")}</TableHead>
                  <TableHead>{t("board.kinesis.streams.status")}</TableHead>
                  <TableHead className="num">{t("board.kinesis.streams.openShards")}</TableHead>
                  <TableHead className="num">{t("board.kinesis.streams.consumers")}</TableHead>
                  <TableHead className="num">{t("board.kinesis.streams.retention")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((entry) => (
                  <TableRow
                    key={entry.name}
                    selected={selected === entry.name}
                    onClick={() => setSelected(entry.name)}
                  >
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <span className="truncate select-text">{entry.name}</span>
                        {entry.mode === "ON_DEMAND" && (
                          <OutlineTag>{t("board.kinesis.streams.onDemandBadge")}</OutlineTag>
                        )}
                      </span>
                    </TableCell>
                    <TableCell>
                      <StreamStatus entry={entry} />
                    </TableCell>
                    <TableCell className="num">{count(entry.openShards)}</TableCell>
                    <TableCell className="num">{count(entry.consumers)}</TableCell>
                    <TableCell className="num">{retention(entry.retentionHours) ?? DASH}</TableCell>
                  </TableRow>
                ))}
                {shown.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      {streams.length === 0
                        ? t("board.kinesis.streams.none")
                        : t("board.common.noMatch")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ListPane>

          {current != null && (
            <StreamSheet
              key={current.name}
              entry={current}
              onEdit={() => {
                setEditing(current);
                setFormOpen(true);
              }}
              onRemove={() => void remove(current)}
              onClose={() => setSelected(null)}
            />
          )}
        </ListArea>
      )}
      {!isBlocked(state) && <StatusBar left={<span>{t("board.kinesis.streams.note")}</span>} />}
    </Page>
  );
}

function StreamStatus({ entry }: { entry: KinesisStream }) {
  if (entry.status == null) return <Status tone="off">{DASH}</Status>;
  return <Status tone={settling(entry) ? "warn" : "ok"}>{entry.status}</Status>;
}

function StreamSheet({
  entry,
  onEdit,
  onRemove,
  onClose,
}: {
  entry: KinesisStream;
  onEdit: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DetailPanel width={380} onDismiss={onClose}>
      <DetailPanelHeader
        title={entry.name}
        badge={<StreamStatus entry={entry} />}
        onClose={onClose}
      />
      <DetailPanelBody>
        <div className="grid grid-cols-2 gap-2">
          <MiniStat
            label={t("board.kinesis.streams.openShards")}
            value={count(entry.openShards)}
          />
          <MiniStat
            label={t("board.kinesis.streams.retention")}
            value={retention(entry.retentionHours) ?? DASH}
          />
        </div>

        {/* Said where the state is, because this is the reading that turns
            every button on the page into an error the service words badly:
            a stream that is not ACTIVE refuses the call as "resource in use". */}
        {settling(entry) && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("board.kinesis.streams.settling", { status: entry.status })}
          </p>
        )}

        <div>
          <SectionLabel className="mb-1.5">
            {t("board.kinesis.streams.section.capacity")}
          </SectionLabel>
          <KV
            rows={[
              [t("board.kinesis.streams.mode"), entry.mode ?? DASH],
              [t("board.kinesis.streams.consumers"), count(entry.consumers)],
            ]}
          />
        </div>

        <div>
          <SectionLabel className="mb-1.5">
            {t("board.kinesis.streams.section.identity")}
          </SectionLabel>
          <KV
            rows={[
              [t("board.kinesis.streams.encryption"), entry.encryption ?? DASH],
              [t("board.kinesis.streams.kmsKey"), entry.kmsKeyId ?? DASH],
              [t("board.kinesis.streams.arn"), entry.arn ?? DASH],
              [t("board.kinesis.streams.createdAt"), formatMessageTime(entry.createdAtMs)],
              [
                t("board.kinesis.streams.shardMetrics"),
                entry.shardMetrics.length === 0
                  ? t("board.kinesis.streams.shardMetricsNone")
                  : entry.shardMetrics.join(", "),
              ],
            ]}
          />
        </div>
      </DetailPanelBody>
      <DetailPanelFooter>
        <Button variant="outline" disabled={settling(entry)} onClick={onEdit}>
          {t("common.edit")}
        </Button>
        <span className="flex-1" />
        <Button variant="destructive" disabled={settling(entry)} onClick={onRemove}>
          {t("common.delete")}
        </Button>
      </DetailPanelFooter>
    </DetailPanel>
  );
}
