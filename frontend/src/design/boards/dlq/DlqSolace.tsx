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
  Status,
} from "@/components";
import { BoardState, isBlocked } from "@/design/boards/BoardState";
import { useSolaceDeadLetters } from "@/hooks/solace/useSolaceDeadLetters";
import {
  SOURCE_TOPIC_ENDPOINT,
  movesEverything,
  redeliveryLimit,
  silentSources,
  targetExists,
} from "@/mq/solace/deadletters";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DeadLetterQueue } from "@bindings/model/models";

const DASH = "—";

function count(value: number): string {
  return value < 0 ? DASH : formatCount(value);
}

/**
 * What points at this queue, as label-and-value pairs.
 *
 * A queue and a topic endpoint are labelled differently rather than merged,
 * because they are configured in different places and a reader fixing one has
 * to know which they are looking at. The redelivery limit sits beside each,
 * because it is what decides when a message travels the pointer at all.
 */
function sourceRows(
  queue: DeadLetterQueue,
  t: (key: string, values?: Record<string, unknown>) => string,
): [string, string][] {
  const rows: [string, string][] = [];
  for (const source of queue.sources ?? []) {
    if (source == null) continue;
    const limit = redeliveryLimit(source);
    const detail =
      limit > 0
        ? t("board.solace.dlq.afterTries", { count: limit })
        : t("board.solace.dlq.noLimit");
    const label =
      source.exchange === SOURCE_TOPIC_ENDPOINT
        ? t("board.solace.dlq.fromEndpoint")
        : t("board.solace.dlq.fromQueue");
    const marked = movesEverything(source) ? "" : ` · ${t("board.solace.dlq.markedOnly")}`;
    rows.push([label, `${source.queue} (${detail})${marked}`]);
  }
  return rows;
}

/**
 * Solace dead messages.
 *
 * There is no dead message queue object on this broker. What there is, on
 * every queue and every topic endpoint, is a pointer at the queue its
 * undelivered messages should go to - so this page is that pointer inverted,
 * and every row is an ordinary queue that something else happens to name.
 *
 * Two failures are what the page is for, and neither shows anywhere else.
 *
 * The first is a pointer at a queue that does not exist. Every endpoint ships
 * pointing at "#DEAD_MSG_QUEUE" and no broker creates a queue by that name, so
 * the ordinary state of an unconfigured Message VPN is that everything given
 * up on is discarded. Those rows are drawn with no depth and said out loud,
 * because a zero would read as an empty queue that is working.
 *
 * The second is a pointer that is never followed. A queue with
 * respectDmqEligible on - the default - moves only a message whose publisher
 * marked it eligible, and most clients mark nothing. So a row can point at a
 * real, empty queue and be wrong for a completely different reason.
 */
export function DlqSolace() {
  const { t } = useTranslation();
  const state = useSolaceDeadLetters();
  const [selected, setSelected] = useState<string | null>(null);

  const queues = useMemo(() => state.data ?? [], [state.data]);
  const current = queues.find((entry) => entry.name === selected) ?? null;

  return (
    <Page>
      <PageHeader
        title={t("shell.nav.solace.dlq")}
        subtitle={t("board.solace.dlq.count", { count: queues.length })}
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
                  <TableHead>{t("board.solace.dlq.name")}</TableHead>
                  <TableHead className="num">{t("board.solace.dlq.depth")}</TableHead>
                  <TableHead className="num">{t("board.solace.dlq.consumers")}</TableHead>
                  <TableHead className="num">{t("board.solace.dlq.sources")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queues.map((entry) => (
                  <TableRow
                    key={entry.name}
                    selected={selected === entry.name}
                    onClick={() => setSelected(entry.name)}
                  >
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <span className="truncate select-text">{entry.name}</span>
                        {!targetExists(entry) && (
                          <Status tone="warn">{t("board.solace.dlq.missingBadge")}</Status>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className={cn("num", entry.depth > 0 && "text-(--c-warn-text)")}>
                      {count(entry.depth)}
                    </TableCell>
                    <TableCell className="num">{count(entry.consumers)}</TableCell>
                    <TableCell className="num">{(entry.sources ?? []).length}</TableCell>
                  </TableRow>
                ))}
                {queues.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      {t("board.solace.dlq.none")}
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
      {!isBlocked(state) && <StatusBar left={<span>{t("board.solace.dlq.note")}</span>} />}
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
  const silent = silentSources(entry).length;
  return (
    <DetailPanel width={380} onDismiss={onClose}>
      <DetailPanelHeader title={entry.name} onClose={onClose} />
      <DetailPanelBody>
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label={t("board.solace.dlq.depth")} value={count(entry.depth)} />
          <MiniStat label={t("board.solace.dlq.consumers")} value={count(entry.consumers)} />
        </div>

        <KV rows={[[t("board.solace.dlq.msgVpn"), entry.namespace || DASH]]} />

        {!targetExists(entry) && (
          <p className="text-xs leading-relaxed text-(--c-warn-text)">
            {t("board.solace.dlq.missingNote", { name: entry.name })}
          </p>
        )}
        {targetExists(entry) && entry.depth > 0 && entry.consumers === 0 && (
          <p className="text-xs leading-relaxed text-(--c-warn-text)">
            {t("board.solace.dlq.nobodyDraining")}
          </p>
        )}
        {silent > 0 && (
          <p className="text-xs leading-relaxed text-(--c-warn-text)">
            {t("board.solace.dlq.markedOnlyNote", { count: silent })}
          </p>
        )}

        <div>
          <SectionLabel className="mb-1.5">{t("board.solace.dlq.section.sources")}</SectionLabel>
          {(entry.sources ?? []).length === 0 ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("board.solace.dlq.noSources")}
            </p>
          ) : (
            <KV rows={sourceRows(entry, t)} />
          )}
        </div>
      </DetailPanelBody>
    </DetailPanel>
  );
}
