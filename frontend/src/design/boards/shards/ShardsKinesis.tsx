import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ListArea,
  ListPane,
  Page,
  PageHeader,
  RefreshButton,
  StatusBar,
  Toolbar,
} from "@/design/shell";
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
  DetailPanelHeader,
  KV,
  SectionLabel,
  SelectField,
  Status,
} from "@/components";
import { BoardState, isBlocked } from "@/design/boards/BoardState";
import { useKinesisDestinations } from "@/hooks/kinesis/useKinesisDestinations";
import { useKinesisShards } from "@/hooks/kinesis/useKinesisShards";
import { stream as readStream } from "@/mq/kinesis/destinations";
import { childrenOf, keyShare, openCount, parentsOf, type Shard } from "@/mq/kinesis/shards";
import { formatCount } from "@/lib/format";

/** A dash, not a zero: an absent figure and a measured zero are not alike. */
const DASH = "—";

function share(value: number | null): string {
  return value == null ? DASH : `${(value * 100).toFixed(1)}%`;
}

/**
 * A stream's shards.
 *
 * The page this family needed and no other has. Every other partitioned broker
 * here reports a count, and a count is all a partition is worth: they are
 * interchangeable slots addressed by index. A shard is not. It is named, it
 * owns the slice of the hash space that decides which records land on it, and
 * it is changed by being split in two or merged with a neighbour rather than
 * resized - which leaves the old shard in place, closed, still holding its
 * records until retention expires, and named as its children's parent.
 *
 * So the table shows closed shards as well as open ones, and says which is
 * which. A reader who came here because a stream "lost data" after a resize is
 * looking for exactly that row: the records are on a parent nobody drained.
 *
 * The key share column is the closest thing to "how much of the traffic should
 * land here". Records are placed by hashing the partition key, so an even
 * spread lands in proportion to those widths - and a stream split unevenly has
 * one shard doing most of the work, which the shard count cannot say.
 */
export function ShardsKinesis() {
  const { t } = useTranslation();
  const streams = useKinesisDestinations();
  const [stream, setStream] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const names = useMemo(
    () => (streams.data ?? []).map(readStream).map((entry) => entry.name),
    [streams.data],
  );

  // The first stream, once there is one. Chosen here rather than defaulted in
  // state because the listing arrives after the first render.
  useEffect(() => {
    if (stream == null && names.length > 0) setStream(names[0] ?? null);
  }, [names, stream]);

  const shards = useKinesisShards(stream);
  const current = shards.shards.find((entry) => entry.id === selected) ?? null;

  const open = openCount(shards.shards);
  const closed = shards.shards.length - open;

  return (
    <Page>
      <PageHeader
        title={t("shell.nav.kinesis.shards")}
        subtitle={t("board.kinesis.shards.count", {
          open: formatCount(open),
          closed: formatCount(closed),
        })}
        actions={
          <RefreshButton
            refreshing={shards.loading}
            online={streams.online}
            onClick={() => void shards.refresh()}
          />
        }
      />
      <Toolbar>
        <SelectField
          className="w-[220px]"
          value={stream ?? ""}
          placeholder={t("board.kinesis.shards.pickStream")}
          // Shard ids repeat from one stream to the next, so a selection
          // cannot follow the switch.
          onValueChange={(next) => {
            setStream(next);
            setSelected(null);
          }}
          options={names.map((name) => ({ value: name }))}
        />
      </Toolbar>
      {isBlocked(streams) ? (
        <BoardState state={streams} />
      ) : (
        <ListArea>
          <ListPane>
            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("board.kinesis.shards.id")}</TableHead>
                  <TableHead>{t("board.kinesis.shards.state")}</TableHead>
                  <TableHead className="num">{t("board.kinesis.shards.keyShare")}</TableHead>
                  <TableHead>{t("board.kinesis.shards.parents")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shards.shards.map((entry) => (
                  <TableRow
                    key={entry.id}
                    selected={selected === entry.id}
                    onClick={() => setSelected(entry.id)}
                  >
                    <TableCell className="select-text">{entry.id}</TableCell>
                    <TableCell>
                      <ShardState entry={entry} />
                    </TableCell>
                    <TableCell className="num">{share(keyShare(entry))}</TableCell>
                    <TableCell className="select-text">
                      {parentsOf(entry).join(", ") || DASH}
                    </TableCell>
                  </TableRow>
                ))}
                {shards.shards.length === 0 && !shards.loading && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className={
                        "py-8 text-center " +
                        (shards.error != null ? "text-(--c-err)" : "text-muted-foreground")
                      }
                    >
                      {shards.error ?? t("board.kinesis.shards.none")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ListPane>

          {current != null && (
            <ShardSheet
              key={current.id}
              entry={current}
              shards={shards.shards}
              onClose={() => setSelected(null)}
            />
          )}
        </ListArea>
      )}
      {!isBlocked(streams) && <StatusBar left={<span>{t("board.kinesis.shards.note")}</span>} />}
    </Page>
  );
}

function ShardState({ entry }: { entry: Shard }) {
  const { t } = useTranslation();
  return entry.closed ? (
    <Status tone="off">{t("board.kinesis.shards.closed")}</Status>
  ) : (
    <Status tone="ok">{t("board.kinesis.shards.open")}</Status>
  );
}

function ShardSheet({
  entry,
  shards,
  onClose,
}: {
  entry: Shard;
  shards: Shard[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const children = childrenOf(shards, entry.id);
  const parents = parentsOf(entry);

  return (
    <DetailPanel width={380} onDismiss={onClose}>
      <DetailPanelHeader title={entry.id} badge={<ShardState entry={entry} />} onClose={onClose} />
      <DetailPanelBody>
        {/* Said where the row is, because a closed shard reads as gone and is
            not: it holds its records until retention expires, and a consumer
            that skipped it skipped them. */}
        {entry.closed && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("board.kinesis.shards.closedNote")}
          </p>
        )}

        <div>
          <SectionLabel className="mb-1.5">{t("board.kinesis.shards.section.range")}</SectionLabel>
          <KV
            rows={[
              [t("board.kinesis.shards.keyShare"), share(keyShare(entry))],
              [t("board.kinesis.shards.startHashKey"), entry.startHashKey || DASH],
              [t("board.kinesis.shards.endHashKey"), entry.endHashKey || DASH],
            ]}
          />
        </div>

        <div>
          <SectionLabel className="mb-1.5">
            {t("board.kinesis.shards.section.sequence")}
          </SectionLabel>
          <KV
            rows={[
              [t("board.kinesis.shards.startSequence"), entry.startSequence || DASH],
              [t("board.kinesis.shards.endSequence"), entry.endSequence || DASH],
            ]}
          />
        </div>

        <div>
          <SectionLabel className="mb-1.5">{t("board.kinesis.shards.section.lineage")}</SectionLabel>
          <KV
            rows={[
              [t("board.kinesis.shards.parents"), parents.join(", ") || DASH],
              [
                t("board.kinesis.shards.children"),
                children.map((child) => child.id).join(", ") || DASH,
              ],
            ]}
          />
        </div>
      </DetailPanelBody>
    </DetailPanel>
  );
}
