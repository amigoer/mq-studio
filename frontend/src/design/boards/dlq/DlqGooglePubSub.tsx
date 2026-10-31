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
import { useGooglePubSubDeadLetters } from "@/hooks/googlepubsub/useGooglePubSubDeadLetters";
import { formatCount } from "@/lib/format";
import type { DeadLetterQueue, DeadLetterSource } from "@bindings/model/models";

const DASH = "—";

function count(value: number): string {
  return value < 0 ? DASH : formatCount(value);
}

/** The bridge types every element as nullable; a source with no topic is not one. */
function sourcesOf(entry: DeadLetterQueue): DeadLetterSource[] {
  return (entry.sources ?? []).flatMap((source) => (source?.queue ? [source] : []));
}

/**
 * Google Pub/Sub dead letters.
 *
 * A dead-letter topic here is an ordinary topic that some subscription's
 * policy points at. Nothing marks one, so the set is found by walking the
 * topology backwards, and reading one afterwards means browsing a subscription
 * on it like any other.
 *
 * The sources column names two things rather than one, and that is this
 * family rather than a flourish: the policy belongs to the subscription, so
 * one topic read by three subscriptions can give up into three different
 * places for three different reasons. Knowing which reader stopped trying is
 * most of what makes the row actionable.
 *
 * There is no depth column, because a topic holds nothing countable - the
 * dead letters are waiting on whatever subscribes to it, and each of those
 * backlogs is a Cloud Monitoring metric. What replaces it is the subscription
 * count, and zero is the row to act on: a dead letter published to a topic
 * nothing subscribes to is discarded on arrival, which makes the messages a
 * system gave up on the ones nobody notices disappearing.
 */
export function DlqGooglePubSub() {
  const { t } = useTranslation();
  const state = useGooglePubSubDeadLetters();
  const [selected, setSelected] = useState<string | null>(null);

  const topics = useMemo(() => state.data ?? [], [state.data]);
  const current = topics.find((entry) => entry.name === selected) ?? null;

  return (
    <Page>
      <PageHeader
        title={t("shell.nav.google-pubsub.dlq")}
        subtitle={t("board.google-pubsub.dlq.count", { count: topics.length })}
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
                  <TableHead className="mqs-col-fill">{t("board.google-pubsub.dlq.name")}</TableHead>
                  <TableHead className="num">{t("board.google-pubsub.dlq.readers")}</TableHead>
                  <TableHead className="mqs-col-secondary">{t("board.google-pubsub.dlq.sources")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topics.map((entry) => (
                  <TableRow
                    key={entry.name}
                    selected={selected === entry.name}
                    onClick={() => setSelected(entry.name)}
                  >
                    <TableCell className="mqs-col-fill">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate select-text">{entry.name}</span>
                        {/* Nothing reads it, so every dead letter that arrives
                            is thrown away on the spot. */}
                        {entry.consumers === 0 && (
                          <Status tone="warn">
                            {t("board.google-pubsub.dlq.noReaderBadge")}
                          </Status>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="num">{count(entry.consumers)}</TableCell>
                    <TableCell className="mqs-col-secondary select-text">
                      {sourcesOf(entry).length === 0
                        ? t("board.google-pubsub.dlq.noSources")
                        : sourcesOf(entry)
                            .map((source) => `${source.queue} · ${source.subscription}`)
                            .join(", ")}
                    </TableCell>
                  </TableRow>
                ))}
                {topics.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                      {t("board.google-pubsub.dlq.none")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ListPane>

          {current != null && (
            <DeadLetterTopicSheet
              key={current.name}
              entry={current}
              onClose={() => setSelected(null)}
            />
          )}
        </ListArea>
      )}
      {!isBlocked(state) && <StatusBar left={<span>{t("board.google-pubsub.dlq.note")}</span>} />}
    </Page>
  );
}

export function DeadLetterTopicSheet({
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
          <MiniStat label={t("board.google-pubsub.dlq.readers")} value={count(entry.consumers)} />
          <MiniStat label={t("board.google-pubsub.dlq.sourceCount")} value={sources.length} />
        </div>

        {entry.consumers === 0 && (
          <p className="text-xs leading-relaxed text-(--c-warn-text)">
            {t("board.google-pubsub.dlq.noReaderNote")}
          </p>
        )}

        <div>
          <SectionLabel className="mb-1.5">{t("board.google-pubsub.dlq.sources")}</SectionLabel>
          {sources.length === 0 ? (
            <p className="text-xs leading-relaxed text-(--c-warn-text)">
              {/* The state worth naming: nothing points here any more, so it
                  will never receive anything again. */}
              {t("board.google-pubsub.dlq.orphaned")}
            </p>
          ) : (
            <KV
              rows={sources.map((source) => [
                source.subscription,
                t("board.google-pubsub.dlq.givesUpFrom", { topic: source.queue }),
              ])}
            />
          )}
        </div>
      </DetailPanelBody>
    </DetailPanel>
  );
}
