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
import { useSqsDeadLetters } from "@/hooks/sqs/useSqsDeadLetters";
import { formatCount } from "@/lib/format";
import type { DeadLetterQueue } from "@bindings/model/models";

const DASH = "—";

function count(value: number): string {
  return value < 0 ? DASH : formatCount(value);
}

// The bridge types every element as nullable; a source row with nothing in
// it is not a source, so it is dropped rather than drawn as a blank name.
function sourcesOf(entry: DeadLetterQueue): string[] {
  return (entry.sources ?? []).flatMap((source) => (source?.queue ? [source.queue] : []));
}

/**
 * Amazon SQS dead letters.
 *
 * A dead-letter queue here is an ordinary queue another queue's redrive policy
 * points at. Nothing marks one, nothing is named after a consumer group -
 * there are none - so the set is found by walking the topology backwards, and
 * reading one afterwards is an ordinary browse on the messages page.
 *
 * The sources column is the reason to open this page rather than the queues
 * board. A dead-letter queue with a backlog and no sources left is one whose
 * producers were deleted or reconfigured: it will never receive anything
 * again, and nothing else in the app says so.
 *
 * There is no consumer count and no retry button. SQS keeps no record of who
 * reads a queue, so a zero would be an invention; and its redrive is a
 * background task that moves a whole queue back to wherever each message came
 * from, which is a different gesture from handing one message to one reader.
 */
export function DlqSqs() {
  const { t } = useTranslation();
  const state = useSqsDeadLetters();
  const [selected, setSelected] = useState<string | null>(null);

  const queues = useMemo(() => state.data ?? [], [state.data]);
  const current = queues.find((entry) => entry.name === selected) ?? null;

  return (
    <Page>
      <PageHeader
        title={t("shell.nav.sqs.dlq")}
        subtitle={t("board.sqs.dlq.count", { count: queues.length })}
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
                  <TableHead className="mqs-col-fill">{t("board.sqs.dlq.name")}</TableHead>
                  <TableHead className="num">{t("board.sqs.dlq.depth")}</TableHead>
                  <TableHead>{t("board.sqs.dlq.sources")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queues.map((entry) => (
                  <TableRow
                    key={entry.name}
                    selected={selected === entry.name}
                    onClick={() => setSelected(entry.name)}
                  >
                    <TableCell className="mqs-col-fill select-text">{entry.name}</TableCell>
                    <TableCell className="num">{count(entry.depth)}</TableCell>
                    <TableCell className="select-text">
                      {sourcesOf(entry).length === 0
                        ? t("board.sqs.dlq.noSources")
                        : sourcesOf(entry).join(", ")}
                    </TableCell>
                  </TableRow>
                ))}
                {queues.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                      {t("board.sqs.dlq.none")}
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
      {!isBlocked(state) && <StatusBar left={<span>{t("board.sqs.dlq.note")}</span>} />}
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
  const sources = sourcesOf(entry);
  return (
    <DetailPanel width={380} onDismiss={onClose}>
      <DetailPanelHeader title={entry.name} onClose={onClose} />
      <DetailPanelBody>
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label={t("board.sqs.dlq.depth")} value={count(entry.depth)} />
          <MiniStat label={t("board.sqs.dlq.sourceCount")} value={sources.length} />
        </div>

        <div>
          <SectionLabel className="mb-1.5">{t("board.sqs.dlq.sources")}</SectionLabel>
          {sources.length === 0 ? (
            <p className="text-xs leading-relaxed text-(--c-warn-text)">
              {/* The state worth naming: a backlog whose producers are
                  gone will never receive anything again and will never
                  drain by itself. */}
              {t("board.sqs.dlq.orphaned")}
            </p>
          ) : (
            <KV rows={sources.map((source) => [source, t("board.sqs.dlq.redrivesHere")])} />
          )}
        </div>
      </DetailPanelBody>
    </DetailPanel>
  );
}
