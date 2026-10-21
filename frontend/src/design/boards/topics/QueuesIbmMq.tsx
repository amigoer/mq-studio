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
import { useIbmMqDestinations } from "@/hooks/ibmmq/useIbmMqDestinations";
import {
  destination as readDestination,
  inhibited,
  type IbmMqDestination,
} from "@/mq/ibmmq/destinations";
import { formatCount } from "@/lib/format";
import { cn, formatErrorMessage } from "@/lib/utils";
import { useConnectionScope } from "@/mq/ConnectionScope";
import * as ibmmqApi from "@/api/ibmmq";
import { QueueDialogIbmMq } from "./QueueDialogIbmMq";

/** A dash, not a zero: an absent figure and a measured zero are not alike. */
const DASH = "—";

function count(value: number | null): string {
  return value == null ? DASH : formatCount(value);
}

/**
 * The queue manager's queues and topics.
 *
 * One page for both, because from an application's side they are one thing:
 * something is opened by name and a message goes into it. Everything else
 * about them differs, which is why the depth column is empty on every topic
 * row and the subscribers column is empty on every queue row - a topic stores
 * nothing, and nothing subscribes to a queue.
 *
 * There is no rate column, and that is the queue manager rather than this
 * board. MQ reports what a queue holds, when it was last put to and last got
 * from, and how old its oldest message is; how fast it is moving is a
 * statistics message published to a system queue on a timer, which is a
 * different thing from a figure a listing can read.
 *
 * The alias and remote rows are here on purpose. They hold nothing, so every
 * figure on them is a dash - and leaving them out would hide exactly the
 * indirection somebody tracing a message needs to see.
 */
export function QueuesIbmMq() {
  const { t } = useTranslation();
  const state = useIbmMqDestinations();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const destinations = useMemo(() => (state.data ?? []).map(readDestination), [state.data]);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return destinations.filter(
      (entry) =>
        needle === "" ||
        entry.name.toLowerCase().includes(needle) ||
        (entry.topicString ?? "").toLowerCase().includes(needle),
    );
  }, [destinations, search]);

  const current = shown.find((entry) => entry.name === selected) ?? null;

  const create = useCallback(
    async (input: ibmmqApi.IBMMQDestinationInput) => {
      await ibmmqApi.createDestination(connID, input);
      toast.success(t("board.ibmmq.queues.created", { name: input.name }));
      await state.refresh();
    },
    [connID, state, t],
  );

  /*
   * The confirmation asks twice on a queue that holds messages, and the second
   * question is a different one. The queue manager refuses to delete a queue
   * with a depth, so deleting one means saying the messages go too - and they
   * are gone, not moved to the dead-letter queue.
   */
  const remove = useCallback(
    async (entry: IbmMqDestination) => {
      const holding = entry.kind === "queue" && (entry.depth ?? 0) > 0;
      const ok = await confirm({
        title: t("board.ibmmq.queues.deleteTitle", { name: entry.name }),
        description: holding
          ? t("board.ibmmq.queues.deleteHolding", { count: entry.depth ?? 0 })
          : t("board.ibmmq.queues.deleteDesc"),
        confirmLabel: t("common.delete"),
        danger: true,
      });
      if (!ok) return;
      try {
        await ibmmqApi.removeDestination(connID, entry.name, holding);
        toast.success(t("board.ibmmq.queues.deleted", { name: entry.name }));
        setSelected(null);
        await state.refresh();
      } catch (deleteError) {
        toast.error(t("board.ibmmq.queues.deleteFailed"), {
          description: formatErrorMessage(deleteError),
        });
      }
    },
    [confirm, connID, state, t],
  );

  return (
    <Page>
      <PageHeader
        title={t("shell.nav.ibmmq.topics")}
        subtitle={t("board.ibmmq.queues.count", { count: destinations.length })}
        actions={
          <>
            <RefreshButton
              refreshing={state.refreshing}
              online={state.online}
              onClick={() => void state.refresh()}
            />
            <Button disabled={!state.online} onClick={() => setFormOpen(true)}>
              <Plus aria-hidden />
              {t("board.ibmmq.queues.create")}
            </Button>
          </>
        }
      />
      <Toolbar>
        <Input
          className="w-60 flex-none"
          value={search}
          placeholder={t("board.ibmmq.queues.search")}
          onChange={(event) => setSearch(event.target.value)}
        />
      </Toolbar>
      <QueueDialogIbmMq open={formOpen} onOpenChange={setFormOpen} onSubmit={create} />
      {isBlocked(state) ? (
        <BoardState state={state} />
      ) : (
        <ListArea>
          <ListPane>
            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("board.ibmmq.queues.name")}</TableHead>
                  <TableHead>{t("board.ibmmq.queues.type")}</TableHead>
                  <TableHead className="num">{t("board.ibmmq.queues.depth")}</TableHead>
                  <TableHead className="num">{t("board.ibmmq.queues.openInput")}</TableHead>
                  <TableHead className="num">{t("board.ibmmq.queues.subscribers")}</TableHead>
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
                        {entry.deadLetterQueue && (
                          <OutlineTag>{t("board.ibmmq.queues.deadLetterBadge")}</OutlineTag>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className={cn(inhibited(entry) && "text-(--c-warn-text)")}>
                      {entry.kind === "topic"
                        ? t("board.ibmmq.queues.kindTopic")
                        : (entry.queueType ?? DASH)}
                    </TableCell>
                    <TableCell className="num">{count(entry.depth)}</TableCell>
                    <TableCell className="num">{count(entry.openInput)}</TableCell>
                    <TableCell className="num">{count(entry.subscribers)}</TableCell>
                  </TableRow>
                ))}
                {shown.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      {destinations.length === 0
                        ? t("board.ibmmq.queues.none")
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
      {!isBlocked(state) && <StatusBar left={<span>{t("board.ibmmq.queues.note")}</span>} />}
    </Page>
  );
}

export function QueueSheet({
  entry,
  onDelete,
  onClose,
}: {
  entry: IbmMqDestination;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DetailPanel width={380} onDismiss={onClose}>
      <DetailPanelHeader title={entry.name} onClose={onClose} />
      <DetailPanelBody>
        {entry.kind === "queue" && (
          <div className="grid grid-cols-2 gap-2">
            <MiniStat label={t("board.ibmmq.queues.depth")} value={count(entry.depth)} />
            <MiniStat label={t("board.ibmmq.queues.openInput")} value={count(entry.openInput)} />
          </div>
        )}

        <div>
          <SectionLabel className="mb-1.5">{t("board.ibmmq.queues.section.definition")}</SectionLabel>
          <KV
            rows={[
              [
                t("board.ibmmq.queues.type"),
                entry.kind === "topic"
                  ? t("board.ibmmq.queues.kindTopic")
                  : (entry.queueType ?? DASH),
              ],
              ...(entry.kind === "topic"
                ? ([
                    [t("board.ibmmq.queues.topicString"), entry.topicString ?? DASH],
                    [t("board.ibmmq.queues.topicType"), entry.topicType ?? DASH],
                  ] as const)
                : ([
                    [t("board.ibmmq.queues.maxDepth"), count(entry.maxDepth)],
                    [t("board.ibmmq.queues.maxMessageLength"), count(entry.maxMessageLength)],
                    [t("board.ibmmq.queues.cluster"), entry.cluster ?? DASH],
                  ] as const)),
              [t("board.ibmmq.queues.description"), entry.description ?? DASH],
              [t("board.ibmmq.queues.altered"), entry.altered ?? DASH],
            ]}
          />
        </div>

        {entry.kind === "queue" && (
          <>
            <div>
              <SectionLabel className="mb-1.5">{t("board.ibmmq.queues.section.runtime")}</SectionLabel>
              <KV
                rows={[
                  [t("board.ibmmq.queues.openOutput"), count(entry.openOutput)],
                  [t("board.ibmmq.queues.uncommitted"), count(entry.uncommitted)],
                  [
                    t("board.ibmmq.queues.oldestMessage"),
                    entry.oldestMessageAgeSec == null
                      ? DASH
                      : t("board.ibmmq.queues.seconds", {
                          count: entry.oldestMessageAgeSec,
                        }),
                  ],
                  [t("board.ibmmq.queues.lastPut"), entry.lastPut ?? DASH],
                  [t("board.ibmmq.queues.lastGet"), entry.lastGet ?? DASH],
                ]}
              />
            </div>

            <div>
              <SectionLabel className="mb-1.5">{t("board.ibmmq.queues.section.handling")}</SectionLabel>
              <KV
                rows={[
                  [t("board.ibmmq.queues.backoutQueue"), entry.backoutQueue ?? DASH],
                  [t("board.ibmmq.queues.backoutThreshold"), count(entry.backoutThreshold)],
                ]}
              />
            </div>
          </>
        )}

        {inhibited(entry) && (
          <p className="text-xs leading-relaxed text-(--c-warn-text)">
            {t("board.ibmmq.queues.inhibited", {
              what: entry.inhibitPut
                ? t("board.ibmmq.queues.inhibitPut")
                : t("board.ibmmq.queues.inhibitGet"),
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
