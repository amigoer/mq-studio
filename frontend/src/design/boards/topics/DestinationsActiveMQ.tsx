import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import {
  ListArea,
  ListPane,
  Page,
  PageHeader,
  RefreshButton,
  StatusBar,
  Toolbar,
} from "@/design/shell";
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
  Segmented,
  Status,
  useConfirm,
} from "@/components";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { BoardState, isBlocked } from "@/design/boards/BoardState";
import { useActiveMQDestinations } from "@/hooks/activemq/useActiveMQDestinations";
import {
  browseWillBeCapped,
  destination as readDestination,
  type ActiveMQDestination,
  type DestinationKind,
} from "@/mq/activemq/destinations";
import { formatBytes, formatCount } from "@/lib/format";
import { formatErrorMessage } from "@/lib/utils";
import { useConnectionScope } from "@/mq/ConnectionScope";
import * as activemqApi from "@/api/activemq";
import {
  DestinationDialogActiveMQ,
  MoveDialogActiveMQ,
} from "./DestinationDialogActiveMQ";

/**
 * A dash, not a zero.
 *
 * One MQKind covers two brokers that report different things, so a column is
 * genuinely empty on one of them. Printing 0 would be this app asserting a
 * figure the broker never gave.
 */
const DASH = "—";

function count(value: number | null): string {
  return value == null ? DASH : formatCount(value);
}

type KindFilter = "all" | DestinationKind;

const KIND_FILTERS = ["all", "queue", "topic"] as const;

/**
 * ActiveMQ destinations - queues and topics, from either product.
 *
 * One table for both kinds rather than two pages. Their management surface is
 * identical: same attributes, same operations, both browsable. What separates
 * them is delivery, and that shows on the subscriptions page - a queue has no
 * named subscribers and a topic does. RabbitMQ splits queues from exchanges
 * because an exchange holds no messages at all; a JMS topic does.
 *
 * Several columns are filled by one product only, and the board leaves the
 * other blank rather than printing a zero. Classic counts producers per
 * destination and Artemis does not; Artemis reports messages waiting for a
 * scheduled delivery time and Classic keeps that count on a broker-wide
 * scheduler instead. A dash means the broker was not asked to guess.
 */
export function DestinationsActiveMQ() {
  const { t } = useTranslation();
  const state = useActiveMQDestinations();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);
  const [kind, setKind] = useState<KindFilter>("all");
  const [selected, setSelected] = useState<string | null>(null);

  const destinations = useMemo(
    () => (state.data ?? []).map(readDestination),
    [state.data],
  );

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return destinations.filter((entry) => {
      if (kind !== "all" && entry.kind !== kind) return false;
      return needle === "" || entry.name.toLowerCase().includes(needle);
    });
  }, [destinations, search, kind]);

  const current = shown.find((entry) => entry.name === selected) ?? null;
  const counts = {
    all: destinations.length,
    queue: destinations.filter((entry) => entry.kind === "queue").length,
    topic: destinations.filter((entry) => entry.kind === "topic").length,
  };

  // Which product answered decides what the table can show, and every row on
  // one connection comes from the same broker.
  const product = destinations[0]?.product ?? null;

  const create = useCallback(
    async (name: string, kind: DestinationKind) => {
      await activemqApi.createDestination(connID, name, kind === "topic");
      toast.success(t("board.activemq.destinations.created", { name }));
      await state.refresh();
    },
    [connID, state, t],
  );

  const purge = useCallback(
    async (entry: ActiveMQDestination) => {
      const ok = await confirm({
        title: t("board.activemq.destinations.purgeTitle", { name: entry.name }),
        // The depth, because it is the number being discarded and the reader
        // is about to lose it. A topic's is the sum across its subscriptions,
        // which is what purging one actually empties.
        description: t("board.activemq.destinations.purgeDesc", {
          count: entry.depth ?? 0,
        }),
        confirmLabel: t("board.common.purge"),
        danger: true,
      });
      if (!ok) return;
      try {
        await activemqApi.purgeQueue(connID, entry.name);
        toast.success(t("board.activemq.destinations.purged", { name: entry.name }));
        await state.refresh();
      } catch (purgeError) {
        toast.error(t("board.activemq.destinations.purgeFailed"), {
          description: formatErrorMessage(purgeError),
        });
      }
    },
    [confirm, connID, state, t],
  );

  const remove = useCallback(
    async (entry: ActiveMQDestination) => {
      const ok = await confirm({
        title: t("board.activemq.destinations.deleteTitle", { name: entry.name }),
        description: t("board.activemq.destinations.deleteDesc"),
        confirmLabel: t("common.delete"),
        danger: true,
      });
      if (!ok) return;
      try {
        await activemqApi.removeDestination(connID, entry.name);
        toast.success(t("board.activemq.destinations.deleted", { name: entry.name }));
        setSelected(null);
        await state.refresh();
      } catch (deleteError) {
        toast.error(t("board.activemq.destinations.deleteFailed"), {
          description: formatErrorMessage(deleteError),
        });
      }
    },
    [confirm, connID, state, t],
  );

  const move = useCallback(
    async (from: string, to: string) => {
      const moved = await activemqApi.moveMessages(connID, { from, to });
      // The broker's own count, which is what separates a move that matched
      // nothing from one that moved everything.
      toast.success(t("board.activemq.destinations.moved", { count: moved }));
      await state.refresh();
    },
    [connID, state, t],
  );

  return (
    <Page>
      <PageHeader
        title={t("shell.nav.activemq.topics")}
        subtitle={t("board.activemq.destinations.count", {
          queues: counts.queue,
          topics: counts.topic,
        })}
        actions={
          <>
            <RefreshButton
              refreshing={state.refreshing}
              online={state.online}
              onClick={() => void state.refresh()}
            />
            <Button disabled={!state.online} onClick={() => setCreating(true)}>
              <Plus aria-hidden />
              {t("board.activemq.destinations.create")}
            </Button>
          </>
        }
      />
      <Toolbar>
        <Input
          className="w-60 flex-none"
          value={search}
          placeholder={t("board.activemq.destinations.search")}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Segmented
          options={KIND_FILTERS.map((option) => ({
            value: option,
            label: `${t(`board.activemq.destinations.kind.${option}`)} ${counts[option]}`,
          }))}
          value={kind}
          onChange={setKind}
        />
      </Toolbar>
      <DestinationDialogActiveMQ
        open={creating}
        onOpenChange={setCreating}
        onCreate={create}
      />
      <MoveDialogActiveMQ
        open={moving != null}
        onOpenChange={(next) => setMoving(next ? moving : null)}
        from={moving ?? ""}
        onMove={(to) => move(moving ?? "", to)}
      />
      {isBlocked(state) ? (
        <BoardState state={state} />
      ) : (
        <ListArea>
          <ListPane>
            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead className="mqs-col-fill">{t("board.activemq.destinations.name")}</TableHead>
                  <TableHead>{t("board.activemq.destinations.kindColumn")}</TableHead>
                  <TableHead className="num">{t("board.activemq.destinations.depth")}</TableHead>
                  <TableHead className="num">
                    {t("board.activemq.destinations.subscribers")}
                  </TableHead>
                  <TableHead className="num">{t("board.activemq.destinations.inFlight")}</TableHead>
                  <TableHead className="num">{t("board.activemq.destinations.enqueued")}</TableHead>
                  <TableHead className="num">{t("board.activemq.destinations.dequeued")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((entry) => (
                  <TableRow
                    key={entry.name}
                    selected={selected === entry.name}
                    onClick={() => setSelected(entry.name)}
                  >
                    <TableCell className="mqs-col-fill">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate select-text">{entry.name}</span>
                        {entry.isDeadLetter && (
                          <OutlineTag>{t("board.activemq.destinations.deadLetterBadge")}</OutlineTag>
                        )}
                        {entry.paused === true && (
                          <Status tone="warn">{t("board.activemq.destinations.pausedBadge")}</Status>
                        )}
                      </span>
                    </TableCell>
                    <TableCell>{t(`board.activemq.destinations.kind.${entry.kind}`)}</TableCell>
                    <TableCell className="num">{count(entry.depth)}</TableCell>
                    <TableCell className="num">{count(entry.subscribers)}</TableCell>
                    <TableCell className="num">{count(entry.inFlight)}</TableCell>
                    <TableCell className="num">{count(entry.enqueued)}</TableCell>
                    <TableCell className="num">{count(entry.dequeued)}</TableCell>
                  </TableRow>
                ))}
                {shown.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      {destinations.length === 0
                        ? t("board.activemq.destinations.none")
                        : t("board.common.noMatch")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ListPane>

          {current != null && (
            <DestinationSheet
              key={current.name}
              entry={current}
              onMove={() => setMoving(current.name)}
              onPurge={() => void purge(current)}
              onDelete={() => void remove(current)}
              onClose={() => setSelected(null)}
            />
          )}
        </ListArea>
      )}
      {product != null && (
        <StatusBar left={<span>{t(`board.activemq.destinations.note.${product}`)}</span>} />
      )}
    </Page>
  );
}

function DestinationSheet({
  entry,
  onMove,
  onPurge,
  onDelete,
  onClose,
}: {
  entry: ActiveMQDestination;
  onMove: () => void;
  onPurge: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DetailPanel width={380} onDismiss={onClose}>
      <DetailPanelHeader
        title={entry.name}
        badge={<OutlineTag>{t(`board.activemq.destinations.kind.${entry.kind}`)}</OutlineTag>}
        onClose={onClose}
      />
      <DetailPanelBody>
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label={t("board.activemq.destinations.depth")} value={count(entry.depth)} />
          <MiniStat
            label={t("board.activemq.destinations.bytes")}
            value={entry.bytes == null ? DASH : formatBytes(entry.bytes)}
          />
        </div>

        {/*
          Said here rather than on the message board alone, because this is
          where a reader learns the destination is deeper than a browse can
          reach - and the number they are looking at is the one that will not
          fit.
        */}
        {browseWillBeCapped(entry) && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("board.activemq.destinations.browseCapped", { cap: entry.browseCap })}
          </p>
        )}

        <div>
          <SectionLabel className="mb-1.5">{t("board.activemq.destinations.section.state")}</SectionLabel>
          <KV
            rows={[
              [t("board.activemq.destinations.subscribers"), count(entry.subscribers)],
              [t("board.activemq.destinations.inFlight"), count(entry.inFlight)],
              [t("board.activemq.destinations.scheduled"), count(entry.scheduled)],
              [t("board.activemq.destinations.expired"), count(entry.expired)],
            ]}
          />
        </div>

        {/*
          Artemis's two levels, shown only where they exist. Classic addresses
          a destination directly and has no address above it, so drawing these
          rows would invent a concept.
        */}
        {entry.product === "artemis" && (
          <div>
            <SectionLabel className="mb-1.5">{t("board.activemq.destinations.section.routing")}</SectionLabel>
            <KV
              rows={[
                [t("board.activemq.destinations.address"), entry.address ?? DASH],
                [t("board.activemq.destinations.routingTypes"), entry.routingTypes ?? DASH],
                [t("board.activemq.destinations.queueCount"), count(entry.queueCount)],
                [
                  t("board.activemq.destinations.deadLetterAddress"),
                  entry.deadLetterAddress ?? DASH,
                ],
                [t("board.activemq.destinations.expiryAddress"), entry.expiryAddress ?? DASH],
                [t("board.activemq.destinations.filter"), entry.filter ?? DASH],
              ]}
            />
          </div>
        )}

        {entry.product === "classic" && (
          <div>
            <SectionLabel className="mb-1.5">{t("board.activemq.destinations.section.classic")}</SectionLabel>
            <KV
              rows={[
                [t("board.activemq.destinations.producers"), count(entry.producers)],
                [t("board.activemq.destinations.dispatched"), count(entry.dispatched)],
                [
                  t("board.activemq.destinations.memoryPercent"),
                  entry.memoryPercent == null ? DASH : `${entry.memoryPercent}%`,
                ],
                [
                  t("board.activemq.destinations.averageSize"),
                  entry.averageMessageSize == null ? DASH : formatBytes(entry.averageMessageSize),
                ],
              ]}
            />
          </div>
        )}
      </DetailPanelBody>
      <DetailPanelFooter>
        <Button variant="outline" onClick={onMove}>
          {t("board.activemq.destinations.moveAction")}
        </Button>
        <span className="flex-1" />
        <Button variant="destructive" onClick={onPurge}>
          {t("board.common.purge")}
        </Button>
        <Button variant="destructive" onClick={onDelete}>
          {t("common.delete")}
        </Button>
      </DetailPanelFooter>
    </DetailPanel>
  );
}
