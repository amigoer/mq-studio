import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ListArea,
  ListPane,
  Page,
  PageHeader,
  RefreshButton,
} from "@/design/shell";
import { Button } from "@/components/ui/button";
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
  SectionLabel,
  useConfirm,
} from "@/components";
import { BoardState, isBlocked } from "@/design/boards/BoardState";
import { useActiveMQDeadLetters } from "@/hooks/activemq/useActiveMQDeadLetters";
import { useActiveMQDestinations } from "@/hooks/activemq/useActiveMQDestinations";
import { destination as readDestination, type Product } from "@/mq/activemq/destinations";
import { formatCount } from "@/lib/format";
import { formatErrorMessage } from "@/lib/utils";
import { useConnectionScope } from "@/mq/ConnectionScope";
import * as activemqApi from "@/api/activemq";
import type { DeadLetterQueue } from "@bindings/model/models";

const DASH = "—";

/**
 * ActiveMQ dead letters.
 *
 * The first family in this app with the full shape. Kafka has no broker-side
 * dead-letter queue at all, NATS moves nothing and publishes an advisory
 * instead, Redis keeps a pending list because it gives up on nothing - so this
 * page has been half empty everywhere except RabbitMQ. ActiveMQ moves the
 * message to a destination the operator named and can put it back, which no
 * other family here can do.
 *
 * A dead-letter destination is an ordinary destination that something else
 * points at, so it is found by walking the declarations backwards rather than
 * by looking up a name. On Artemis every queue records the address its
 * undeliverable messages go to, so the page can say what feeds this one and,
 * more usefully, when nothing does any more - a backlog whose producers were
 * all deleted will never receive anything again and never drain. Classic
 * decides by a broker-wide policy and keeps no such record, so that column is
 * blank there rather than guessed at from names.
 */
export function DlqActiveMQ() {
  const { t } = useTranslation();
  const state = useActiveMQDeadLetters();
  const destinationState = useActiveMQDestinations();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();
  const [selected, setSelected] = useState<string | null>(null);

  const queues = useMemo(() => state.data ?? [], [state.data]);
  const current = queues.find((entry) => entry.name === selected) ?? null;

  // Which product answered, so the page can explain an empty sources column
  // rather than leaving it looking like missing data.
  const product = useMemo(
    () => (destinationState.data ?? []).map(readDestination)[0]?.product ?? null,
    [destinationState.data],
  );

  const retry = useCallback(
    async (queue: DeadLetterQueue) => {
      const ok = await confirm({
        title: t("board.activemq.dlq.retryTitle", { name: queue.name }),
        description: t("board.activemq.dlq.retryDesc", { count: queue.depth }),
        confirmLabel: t("board.activemq.dlq.retry"),
      });
      if (!ok) return;
      try {
        const moved = await activemqApi.retryDeadLetters(connID, queue.name);
        toast.success(t("board.activemq.dlq.retried", { count: moved }));
        await state.refresh();
      } catch (retryError) {
        toast.error(t("board.activemq.dlq.retryFailed"), {
          description: formatErrorMessage(retryError),
        });
      }
    },
    [confirm, connID, state, t],
  );

  return (
    <Page>
      <PageHeader
        title={t("shell.nav.activemq.dlq")}
        subtitle={t("board.activemq.dlq.count", { count: queues.length })}
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
                  <TableHead className="mqs-col-fill">{t("board.activemq.dlq.name")}</TableHead>
                  <TableHead className="num">{t("board.activemq.dlq.depth")}</TableHead>
                  <TableHead className="num">{t("board.activemq.dlq.consumers")}</TableHead>
                  <TableHead className="num">{t("board.activemq.dlq.sources")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queues.map((queue) => (
                  <TableRow
                    key={queue.name}
                    selected={selected === queue.name}
                    onClick={() => setSelected(queue.name)}
                  >
                    <TableCell className="mqs-col-fill select-text">{queue.name}</TableCell>
                    <TableCell className="num">{formatCount(Number(queue.depth))}</TableCell>
                    <TableCell className="num">{formatCount(queue.consumers)}</TableCell>
                    <TableCell className="num">
                      {/*
                        Blank rather than 0 on Classic: nothing was
                        counted, as against nothing pointing here.
                      */}
                      {product === "classic" ? DASH : formatCount(queue.sources?.length ?? 0)}
                    </TableCell>
                  </TableRow>
                ))}
                {queues.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      {t("board.activemq.dlq.none")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ListPane>

          {current != null && (
            <DeadLetterSheet
              key={current.name}
              queue={current}
              product={product}
              onRetry={() => void retry(current)}
              onClose={() => setSelected(null)}
            />
          )}
        </ListArea>
      )}
    </Page>
  );
}

function DeadLetterSheet({
  queue,
  product,
  onRetry,
  onClose,
}: {
  queue: DeadLetterQueue;
  product: Product | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DetailPanel width={380} onDismiss={onClose}>
      <DetailPanelHeader title={queue.name} onClose={onClose} />
      <DetailPanelBody>
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label={t("board.activemq.dlq.depth")} value={formatCount(Number(queue.depth))} />
          <MiniStat label={t("board.activemq.dlq.consumers")} value={formatCount(queue.consumers)} />
        </div>

        <div>
          <SectionLabel className="mb-1.5">{t("board.activemq.dlq.section.sources")}</SectionLabel>
          {product === "classic" ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("board.activemq.dlq.noSourcesClassic")}
            </p>
          ) : (queue.sources?.length ?? 0) === 0 ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("board.activemq.dlq.noSourcesArtemis")}
            </p>
          ) : (
            <KV
              rows={(queue.sources ?? [])
                .filter((source) => source != null)
                .map((source) => [
                  source.queue,
                  // Which reader of the source gave up, where the
                  // family attaches the policy to a subscriber. Both
                  // ActiveMQ products attach it to the destination, so
                  // this is blank here and the column is kept because
                  // the model is shared.
                  source.subscription === "" ? DASH : source.subscription,
                ])}
            />
          )}
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("board.activemq.dlq.retryNote")}
        </p>
      </DetailPanelBody>
      <DetailPanelFooter>
        <Button variant="outline" disabled={Number(queue.depth) === 0} onClick={onRetry}>
          {t("board.activemq.dlq.retry")}
        </Button>
      </DetailPanelFooter>
    </DetailPanel>
  );
}
