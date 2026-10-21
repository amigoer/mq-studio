import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ListArea,
  ListPane,
  Page,
  PageHeader,
  RefreshButton,
  StatusBar,
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
  MiniStat,
  SectionLabel,
} from "@/components";
import { BoardState, isBlocked } from "@/design/boards/BoardState";
import { useIbmMqDeadLetters } from "@/hooks/ibmmq/useIbmMqDeadLetters";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DeadLetterQueue } from "@bindings/model/models";

const DASH = "—";

/** The attribute names the driver puts in a source's exchange field. */
const DEADQ = "DEADQ";

function count(value: number): string {
  return value < 0 ? DASH : formatCount(value);
}

/**
 * What points at this queue, as label-and-value pairs.
 *
 * The two pointers are labelled differently rather than merged. The queue
 * manager fills its own DEADQ; a backout queue is filled by whichever
 * application gave up after the threshold, so the threshold belongs beside it
 * - a backout queue whose threshold is zero receives nothing at all.
 */
function sourceRows(
  queue: DeadLetterQueue,
  t: (key: string) => string,
): [string, string][] {
  const rows: [string, string][] = [];
  for (const source of queue.sources ?? []) {
    if (source == null) continue;
    if (source.exchange === DEADQ) {
      rows.push([t("board.ibmmq.dlq.fromQueueManager"), source.queue]);
      continue;
    }
    const threshold =
      source.routingKey === "" || source.routingKey === "0"
        ? t("board.ibmmq.dlq.thresholdNone")
        : source.routingKey;
    rows.push([
      t("board.ibmmq.dlq.fromQueue"),
      `${source.queue} (${t("board.ibmmq.dlq.threshold")} ${threshold})`,
    ]);
  }
  return rows;
}

/**
 * IBM MQ dead letters.
 *
 * Nothing on this queue manager is marked as a dead-letter queue, so the page
 * is built by inverting configuration: the queue manager's DEADQ attribute
 * names one, and every queue's backout queue names another. That is why the
 * sources column is the important one - a dead-letter queue with no source
 * would not be on this page at all, and one whose only source was deleted will
 * never receive anything again and never drain.
 *
 * The two pointers are told apart rather than merged, because they are filled
 * by different things. The queue manager fills its own DEADQ, with anything it
 * could not deliver - a message for a queue that is full, put-inhibited or
 * gone. A backout queue is filled by whichever application decided to give up
 * after the queue's backout threshold, so a threshold of zero means messages
 * never travel that pointer at all.
 *
 * There is no message list here, and that is not an omission. A dead letter
 * carries a dead-letter header in front of its payload, so the queue manager
 * stores it as MQDEAD and the REST interface will not decode it - the messages
 * page lists them with their identifiers and says so.
 */
export function DlqIbmMq() {
  const { t } = useTranslation();
  const state = useIbmMqDeadLetters();
  const [selected, setSelected] = useState<string | null>(null);

  const queues = useMemo(() => state.data ?? [], [state.data]);
  const current = queues.find((entry) => entry.name === selected) ?? null;

  return (
    <Page>
      <PageHeader
        title={t("shell.nav.ibmmq.dlq")}
        subtitle={t("board.ibmmq.dlq.count", { count: queues.length })}
        actions={
          <RefreshButton
            refreshing={state.refreshing}
            online={state.online}
            onClick={() => void state.refresh()}
          />
        }
      />
      {isBlocked(state) ? (
        <BoardState state={state} />
      ) : (
        <ListArea>
          <ListPane>
            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("board.ibmmq.dlq.queue")}</TableHead>
                  <TableHead className="num">{t("board.ibmmq.dlq.depth")}</TableHead>
                  <TableHead className="num">{t("board.ibmmq.dlq.consumers")}</TableHead>
                  <TableHead className="num">{t("board.ibmmq.dlq.sources")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queues.map((entry) => (
                  <TableRow
                    key={entry.name}
                    selected={selected === entry.name}
                    onClick={() => setSelected(entry.name)}
                  >
                    <TableCell className="select-text">{entry.name}</TableCell>
                    <TableCell className={cn("num", entry.depth > 0 && "text-(--c-warn-text)")}>
                      {count(entry.depth)}
                    </TableCell>
                    <TableCell className="num">{entry.consumers}</TableCell>
                    <TableCell className="num">{entry.sources?.length ?? 0}</TableCell>
                  </TableRow>
                ))}
                {queues.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      {t("board.ibmmq.dlq.none")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ListPane>

          {current != null && (
            <DeadLetterSheet
              key={current.name}
              entry={current}
              onClose={() => setSelected(null)}
            />
          )}
        </ListArea>
      )}
      {!isBlocked(state) && <StatusBar left={<span>{t("board.ibmmq.dlq.note")}</span>} />}
    </Page>
  );
}

export function DeadLetterSheet({
  entry,
  onClose,
}: {
  entry: DeadLetterQueue;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DetailPanel width={380} onDismiss={onClose}>
      <DetailPanelHeader title={entry.name} onClose={onClose} />
      <DetailPanelBody>
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label={t("board.ibmmq.dlq.depth")} value={count(entry.depth)} />
          <MiniStat label={t("board.ibmmq.dlq.consumers")} value={entry.consumers} />
        </div>

        {entry.depth > 0 && entry.consumers === 0 && (
          <p className="text-xs leading-relaxed text-(--c-warn-text)">
            {t("board.ibmmq.dlq.nobodyDraining")}
          </p>
        )}

        <div>
          <SectionLabel className="mb-1.5">{t("board.ibmmq.dlq.section.sources")}</SectionLabel>
          <KV rows={sourceRows(entry, t)} />
        </div>
      </DetailPanelBody>
    </DetailPanel>
  );
}
