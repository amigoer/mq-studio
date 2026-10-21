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
import { useNsqSubscriptions } from "@/hooks/nsq/useNsqSubscriptions";
import {
  channel as readChannel,
  channelKey,
  stalledByPause,
  type NsqChannel,
} from "@/mq/nsq/subscriptions";
import { formatCount } from "@/lib/format";
import { formatErrorMessage } from "@/lib/utils";
import { useConnectionScope } from "@/mq/ConnectionScope";
import * as nsqApi from "@/api/nsq";
import { ChannelDialogNsq } from "./ChannelDialogNsq";

/** A dash, not a zero: an absent figure and a measured zero are not alike. */
const DASH = "—";

function count(value: number | null): string {
  return value == null ? DASH : formatCount(value);
}

/**
 * NSQ channels, which are this family's consumer groups.
 *
 * A channel belongs to one topic and every channel under a topic receives a
 * copy of every message, so the topic is half the identity rather than a
 * column: "analytics" under two topics is two channels with nothing in common.
 *
 * The backlog is the depth, and it is the only lag NSQ has. There is no offset
 * behind it and therefore nothing on this page that moves one - a channel's
 * backlog changes by being consumed or by being emptied, and no third gesture
 * exists. A channel added to a topic that already has one starts at nothing,
 * because the copies were made as the messages arrived.
 *
 * In flight and deferred sit outside the backlog rather than inside it, which
 * is why they have columns: a channel showing zero depth with a hundred in
 * flight has a hundred messages out with consumers that have not answered.
 */
export function ChannelsNsq() {
  const { t } = useTranslation();
  const state = useNsqSubscriptions();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const channels = useMemo(() => (state.data ?? []).map(readChannel), [state.data]);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return channels.filter(
      (entry) =>
        needle === "" ||
        entry.name.toLowerCase().includes(needle) ||
        entry.topic.toLowerCase().includes(needle),
    );
  }, [channels, search]);

  const current = shown.find((entry) => channelKey(entry) === selected) ?? null;

  const create = useCallback(
    async (topic: string, name: string) => {
      await nsqApi.createChannel(connID, topic, name);
      toast.success(t("board.nsq.channels.created", { name }));
      await state.refresh();
    },
    [connID, state, t],
  );

  const empty = useCallback(
    async (entry: NsqChannel) => {
      const ok = await confirm({
        title: t("board.nsq.channels.emptyTitle", { name: entry.name }),
        description: t("board.nsq.channels.emptyDesc", { count: entry.backlog ?? 0 }),
        confirmLabel: t("board.nsq.channels.emptyAction"),
        danger: true,
      });
      if (!ok) return;
      try {
        await nsqApi.emptyChannel(connID, entry.topic, entry.name);
        toast.success(t("board.nsq.channels.emptied", { name: entry.name }));
        await state.refresh();
      } catch (emptyError) {
        toast.error(t("board.nsq.channels.emptyFailed"), {
          description: formatErrorMessage(emptyError),
        });
      }
    },
    [confirm, connID, state, t],
  );

  const remove = useCallback(
    async (entry: NsqChannel) => {
      const ok = await confirm({
        title: t("board.nsq.channels.deleteTitle", { name: entry.name }),
        description: t("board.nsq.channels.deleteDesc", { topic: entry.topic }),
        confirmLabel: t("common.delete"),
        danger: true,
      });
      if (!ok) return;
      try {
        await nsqApi.removeChannel(connID, entry.topic, entry.name);
        toast.success(t("board.nsq.channels.deleted", { name: entry.name }));
        setSelected(null);
        await state.refresh();
      } catch (deleteError) {
        toast.error(t("board.nsq.channels.deleteFailed"), {
          description: formatErrorMessage(deleteError),
        });
      }
    },
    [confirm, connID, state, t],
  );

  // No confirmation: pausing takes nothing away and the same button undoes it.
  const pause = useCallback(
    async (entry: NsqChannel) => {
      try {
        await nsqApi.setChannelPaused(connID, entry.topic, entry.name, !entry.paused);
        toast.success(
          t(entry.paused ? "board.nsq.channels.resumed" : "board.nsq.channels.paused", {
            name: entry.name,
          }),
        );
        await state.refresh();
      } catch (pauseError) {
        toast.error(t("board.nsq.channels.pauseFailed"), {
          description: formatErrorMessage(pauseError),
        });
      }
    },
    [connID, state, t],
  );

  return (
    <Page>
      <PageHeader
        title={t("shell.nav.nsq.consumers")}
        subtitle={t("board.nsq.channels.count", { count: channels.length })}
        actions={
          <>
            <RefreshButton
              refreshing={state.refreshing}
              online={state.online}
              onClick={() => void state.refresh()}
            />
            <Button disabled={!state.online} onClick={() => setCreating(true)}>
              <Plus aria-hidden />
              {t("board.nsq.channels.create")}
            </Button>
          </>
        }
      />
      <Toolbar>
        <Input
          className="w-60 flex-none"
          value={search}
          placeholder={t("board.nsq.channels.search")}
          onChange={(event) => setSearch(event.target.value)}
        />
      </Toolbar>
      <ChannelDialogNsq open={creating} onOpenChange={setCreating} onCreate={create} />
      {isBlocked(state) ? (
        <BoardState state={state} />
      ) : (
        <ListArea>
          <ListPane>
            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("board.nsq.channels.name")}</TableHead>
                  <TableHead>{t("board.nsq.channels.topic")}</TableHead>
                  <TableHead className="num">{t("board.nsq.channels.backlog")}</TableHead>
                  <TableHead className="num">{t("board.nsq.channels.inFlight")}</TableHead>
                  <TableHead className="num">{t("board.nsq.channels.deferred")}</TableHead>
                  <TableHead className="num">{t("board.nsq.channels.clients")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((entry) => (
                  <TableRow
                    key={channelKey(entry)}
                    selected={selected === channelKey(entry)}
                    onClick={() => setSelected(channelKey(entry))}
                  >
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <span className="truncate select-text">{entry.name}</span>
                        {entry.paused ? (
                          <Status tone="warn">{t("board.nsq.channels.pausedBadge")}</Status>
                        ) : (
                          entry.clients === 0 && (
                            <Status tone="off">{t("board.nsq.channels.idleBadge")}</Status>
                          )
                        )}
                        {entry.ephemeral && (
                          <OutlineTag>{t("board.nsq.channels.ephemeralBadge")}</OutlineTag>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="select-text">{entry.topic}</TableCell>
                    <TableCell className="num">{count(entry.backlog)}</TableCell>
                    <TableCell className="num">{count(entry.inFlight)}</TableCell>
                    <TableCell className="num">{count(entry.deferred)}</TableCell>
                    <TableCell className="num">{entry.clients}</TableCell>
                  </TableRow>
                ))}
                {shown.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      {channels.length === 0
                        ? t("board.nsq.channels.none")
                        : t("board.common.noMatch")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ListPane>

          {current != null && (
            <ChannelSheet
              key={channelKey(current)}
              entry={current}
              onEmpty={() => void empty(current)}
              onRemove={() => void remove(current)}
              onTogglePause={() => void pause(current)}
              onClose={() => setSelected(null)}
            />
          )}
        </ListArea>
      )}
      {!isBlocked(state) && <StatusBar left={<span>{t("board.nsq.channels.note")}</span>} />}
    </Page>
  );
}

export function ChannelSheet({
  entry,
  onEmpty,
  onRemove,
  onTogglePause,
  onClose,
}: {
  entry: NsqChannel;
  onEmpty: () => void;
  onRemove: () => void;
  onTogglePause: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DetailPanel width={380} onDismiss={onClose}>
      <DetailPanelHeader
        title={entry.name}
        badge={
          <>
            {entry.paused && <Status tone="warn">{t("board.nsq.channels.pausedBadge")}</Status>}
            {entry.ephemeral && <OutlineTag>{t("board.nsq.channels.ephemeralBadge")}</OutlineTag>}
          </>
        }
        onClose={onClose}
      />
      <DetailPanelBody>
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label={t("board.nsq.channels.backlog")} value={count(entry.backlog)} />
          <MiniStat label={t("board.nsq.channels.inFlight")} value={count(entry.inFlight)} />
        </div>

        {/* The one backlog with no consumer to look at. */}
        {stalledByPause(entry) && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("board.nsq.channels.stalled", { count: entry.backlog ?? 0 })}
          </p>
        )}

        <div>
          <SectionLabel className="mb-1.5">{t("board.nsq.channels.section.backlog")}</SectionLabel>
          <KV
            rows={[
              [
                t("board.nsq.channels.topic"),
                <span className="select-text">{entry.topic}</span>,
              ],
              [t("board.nsq.channels.backendDepth"), count(entry.backendDepth)],
              [t("board.nsq.channels.deferred"), count(entry.deferred)],
            ]}
          />
        </div>

        <div>
          <SectionLabel className="mb-1.5">{t("board.nsq.channels.section.delivery")}</SectionLabel>
          <KV
            rows={[
              [t("board.nsq.channels.messages"), count(entry.messages)],
              [t("board.nsq.channels.requeued"), count(entry.requeued)],
              [t("board.nsq.channels.timedOut"), count(entry.timedOut)],
              [t("board.nsq.channels.clients"), String(entry.clients)],
              [t("board.nsq.channels.nodes"), entry.nodes.join(", ") || DASH],
            ]}
          />
        </div>
      </DetailPanelBody>
      <DetailPanelFooter>
        <Button variant="outline" onClick={onTogglePause}>
          {t(entry.paused ? "board.nsq.channels.resumeAction" : "board.nsq.channels.pauseAction")}
        </Button>
        <span className="flex-1" />
        <Button variant="destructive" onClick={onEmpty}>
          {t("board.nsq.channels.emptyAction")}
        </Button>
        <Button variant="destructive" onClick={onRemove}>
          {t("common.delete")}
        </Button>
      </DetailPanelFooter>
    </DetailPanel>
  );
}
