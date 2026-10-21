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
  useConfirm,
} from "@/components";
import { BoardState, isBlocked } from "@/design/boards/BoardState";
import { useSolaceDestinations } from "@/hooks/solace/useSolaceDestinations";
import {
  destination as readDestination,
  halted,
  hasDeadMsgQueue,
  type SolaceDestination,
} from "@/mq/solace/destinations";
import { formatBytes, formatCount } from "@/lib/format";
import { cn, formatErrorMessage } from "@/lib/utils";
import { useConnectionScope } from "@/mq/ConnectionScope";
import * as solaceApi from "@/api/solace";
import { QueueDialogSolace } from "./QueueDialogSolace";

/** A dash, not a zero: an absent figure and a measured zero are not alike. */
const DASH = "—";

function count(value: number | null): string {
  return value == null ? DASH : formatCount(value);
}

/**
 * The Message VPN's queues.
 *
 * Queues only, and that is a decision rather than an omission. A Message VPN
 * has a second kind of endpoint - a topic endpoint - whose name is its
 * routing: it takes what is published to the topic it is named for and there
 * is nothing else to say about it. Those are on the routing page beside the
 * topic subscriptions, which is where a reader asking "where does this
 * publication land" is looking.
 *
 * The spooled column is the one figure on this page that no field on the queue
 * carries. SEMP's spooledMsgCount reads exactly like a depth and is a lifetime
 * counter: it survives a queue being drained and it is reset by clearStats, so
 * a board built on it shows a full queue as empty and an empty one as full.
 * The driver reads the message collection's own count instead, and the
 * lifetime figure is on the detail panel under its own name.
 */
export function QueuesSolace() {
  const { t } = useTranslation();
  const state = useSolaceDestinations();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const destinations = useMemo(() => (state.data ?? []).map(readDestination), [state.data]);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return destinations.filter(
      (entry) => needle === "" || entry.name.toLowerCase().includes(needle),
    );
  }, [destinations, search]);

  const current = shown.find((entry) => entry.name === selected) ?? null;

  const create = useCallback(
    async (input: solaceApi.SolaceQueueInput) => {
      await solaceApi.createQueue(connID, input);
      toast.success(t("board.solace.queues.created", { name: input.name }));
      await state.refresh();
    },
    [connID, state, t],
  );

  /*
   * The confirmation says the messages go too, because they do and because
   * nothing stops it.
   *
   * IBM MQ refuses to delete a queue with a depth unless the caller asks for a
   * purge, so its dialog can offer the check as a second question. SEMP has no
   * such precondition: it deletes a queue holding a quarter of a million
   * messages without a word, and they are discarded rather than dead-lettered.
   * This wording is the only guard there is.
   */
  const remove = useCallback(
    async (entry: SolaceDestination) => {
      const holding = entry.depth ?? 0;
      const ok = await confirm({
        title: t("board.solace.queues.deleteTitle", { name: entry.name }),
        description:
          holding > 0
            ? t("board.solace.queues.deleteHolding", { count: holding })
            : t("board.solace.queues.deleteDesc"),
        confirmLabel: t("common.delete"),
        danger: true,
      });
      if (!ok) return;
      try {
        await solaceApi.removeQueue(connID, entry.name);
        toast.success(t("board.solace.queues.deleted", { name: entry.name }));
        setSelected(null);
        await state.refresh();
      } catch (deleteError) {
        toast.error(t("board.solace.queues.deleteFailed"), {
          description: formatErrorMessage(deleteError),
        });
      }
    },
    [confirm, connID, state, t],
  );

  return (
    <Page>
      <PageHeader
        title={t("shell.nav.solace.topics")}
        subtitle={t("board.solace.queues.count", { count: destinations.length })}
        actions={
          <>
            <RefreshButton
              refreshing={state.refreshing}
              online={state.online}
              onClick={() => void state.refresh()}
            />
            <Button disabled={!state.online} onClick={() => setFormOpen(true)}>
              <Plus aria-hidden />
              {t("board.solace.queues.create")}
            </Button>
          </>
        }
      />
      <Toolbar>
        <Input
          className="w-60 flex-none"
          value={search}
          placeholder={t("board.solace.queues.search")}
          onChange={(event) => setSearch(event.target.value)}
        />
      </Toolbar>
      <QueueDialogSolace open={formOpen} onOpenChange={setFormOpen} onSubmit={create} />
      {isBlocked(state) ? (
        <BoardState state={state} />
      ) : (
        <ListArea>
          <ListPane>
            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("board.solace.queues.name")}</TableHead>
                  <TableHead>{t("board.solace.queues.accessType")}</TableHead>
                  <TableHead className="num">{t("board.solace.queues.spooled")}</TableHead>
                  <TableHead className="num">{t("board.solace.queues.bound")}</TableHead>
                  <TableHead className="num">{t("board.solace.queues.rateIn")}</TableHead>
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
                        {hasDeadMsgQueue(entry) && (
                          <OutlineTag>{t("board.solace.queues.dmqBadge")}</OutlineTag>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className={cn(halted(entry) && "text-(--c-warn-text)")}>
                      {entry.accessType ?? DASH}
                    </TableCell>
                    <TableCell className="num">{count(entry.depth)}</TableCell>
                    <TableCell className="num">{count(entry.boundConsumers)}</TableCell>
                    <TableCell className="num">{count(entry.rateIn)}</TableCell>
                  </TableRow>
                ))}
                {shown.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      {destinations.length === 0
                        ? t("board.solace.queues.none")
                        : t("board.common.noMatch")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ListPane>

          {current != null && (
            <QueueSheet
              key={current.name}
              entry={current}
              onDelete={() => void remove(current)}
              onClose={() => setSelected(null)}
            />
          )}
        </ListArea>
      )}
      {!isBlocked(state) && <StatusBar left={<span>{t("board.solace.queues.note")}</span>} />}
    </Page>
  );
}

export function QueueSheet({
  entry,
  onDelete,
  onClose,
}: {
  entry: SolaceDestination;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DetailPanel width={380} onDismiss={onClose}>
      <DetailPanelHeader title={entry.name} onClose={onClose} />
      <DetailPanelBody>
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label={t("board.solace.queues.spooled")} value={count(entry.depth)} />
          <MiniStat label={t("board.solace.queues.bound")} value={count(entry.boundConsumers)} />
        </div>

        <div>
          <SectionLabel className="mb-1.5">{t("board.solace.queues.section.definition")}</SectionLabel>
          <KV
            rows={[
              [t("board.solace.queues.accessType"), entry.accessType ?? DASH],
              [t("board.solace.queues.permission"), entry.permission ?? DASH],
              [t("board.solace.queues.owner"), entry.owner ?? DASH],
              [
                t("board.solace.queues.maxSpool"),
                entry.maxSpoolUsageMb == null
                  ? DASH
                  : formatBytes(entry.maxSpoolUsageMb * 1024 * 1024),
              ],
              [
                t("board.solace.queues.maxMsgSize"),
                entry.maxMsgSizeBytes == null ? DASH : formatBytes(entry.maxMsgSizeBytes),
              ],
              [t("board.solace.queues.partitions"), count(entry.partitionCount)],
            ]}
          />
        </div>

        <div>
          <SectionLabel className="mb-1.5">{t("board.solace.queues.section.runtime")}</SectionLabel>
          <KV
            rows={[
              [
                t("board.solace.queues.spoolUsage"),
                entry.spoolUsageBytes == null ? DASH : formatBytes(entry.spoolUsageBytes),
              ],
              [t("board.solace.queues.unacked"), count(entry.unackedMsgCount)],
              [t("board.solace.queues.redelivered"), count(entry.redeliveredMsgCount)],
              [t("board.solace.queues.spooledTotal"), count(entry.spooledTotal)],
            ]}
          />
        </div>

        <div>
          <SectionLabel className="mb-1.5">{t("board.solace.queues.section.handling")}</SectionLabel>
          <KV
            rows={[
              [t("board.solace.queues.deadMsgQueue"), entry.deadMsgQueue ?? DASH],
              [t("board.solace.queues.maxRedelivery"), count(entry.maxRedeliveryCount)],
              [
                t("board.solace.queues.maxTtl"),
                entry.maxTtlSec == null || entry.maxTtlSec === 0
                  ? DASH
                  : t("board.solace.queues.seconds", { count: entry.maxTtlSec }),
              ],
              [t("board.solace.queues.toDmqTtl"), count(entry.ttlExpiredToDmq)],
              [t("board.solace.queues.toDmqRetry"), count(entry.redeliveryExceededToDmq)],
            ]}
          />
        </div>

        {halted(entry) && (
          <p className="text-xs leading-relaxed text-(--c-warn-text)">
            {t("board.solace.queues.halted", {
              what: !entry.ingressEnabled
                ? t("board.solace.queues.ingress")
                : t("board.solace.queues.egress"),
            })}
          </p>
        )}
      </DetailPanelBody>
      <DetailPanelFooter>
        <span className="flex-1" />
        <Button variant="destructive" onClick={onDelete}>
          {t("common.delete")}
        </Button>
      </DetailPanelFooter>
    </DetailPanel>
  );
}
