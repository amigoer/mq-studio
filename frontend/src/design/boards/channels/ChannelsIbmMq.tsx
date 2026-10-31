import { useMemo, useState } from "react";
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
  DetailPanelHeader,
  KV,
  MiniStat,
  SectionLabel,
  Status,
} from "@/components";
import { BoardState, isBlocked } from "@/design/boards/BoardState";
import { useIbmMqChannels } from "@/hooks/ibmmq/useIbmMqChannels";
import { group, metric, statusExpected, unhealthy } from "@/mq/ibmmq/channels";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Channel } from "@bindings/model/models";

/** A dash, not a zero: an absent figure and a measured zero are not alike. */
const DASH = "—";

function count(value: number | null): string {
  return value == null ? DASH : formatCount(value);
}

function statusOf(entry: Channel, t: (key: string) => string): string {
  if (entry.status !== "") return entry.status;
  return statusExpected(entry)
    ? t("board.ibmmq.channels.neverStarted")
    : t("board.ibmmq.channels.notRunHere");
}

/**
 * The channels a queue manager defines.
 *
 * This is not the clients page and could not be. A channel is a definition an
 * administrator made: it is here whether or not anything is using it, it is
 * what decides whether a connection is allowed at all, and one definition
 * carries one running instance per connected application. A page built from
 * connections would be empty on a queue manager whose applications are idle,
 * which is exactly when somebody is looking for why they cannot connect.
 *
 * An empty status is a real answer and is not coloured. A channel nobody has
 * started has none, and a client-connection definition never has one - this
 * queue manager holds it on behalf of clients and does not run it. Painting
 * either red would paint most of a fresh queue manager red.
 *
 * The counters are one running instance's totals since it started rather than
 * the definition's lifetime, and they reset when a channel restarts. That is
 * worth knowing before reading a zero as "never used", which is why a channel
 * with nothing running shows a dash instead.
 */
export function ChannelsIbmMq() {
  const { t } = useTranslation();
  const state = useIbmMqChannels();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const channels = useMemo(() => state.data ?? [], [state.data]);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return channels.filter(
      (entry) =>
        needle === "" ||
        entry.name.toLowerCase().includes(needle) ||
        entry.connectionName.toLowerCase().includes(needle),
    );
  }, [channels, search]);

  const current = shown.find((entry) => entry.name === selected) ?? null;

  return (
    <Page>
      <PageHeader
        title={t("shell.nav.ibmmq.channels")}
        subtitle={t("board.ibmmq.channels.count", { count: channels.length })}
        actions={
          <RefreshButton
            refreshing={state.refreshing}
            online={state.online}
            onClick={() => void state.refresh()}
          />
        }
      />
      <Toolbar>
        <Input
          className="w-60 flex-none"
          value={search}
          placeholder={t("board.ibmmq.channels.search")}
          onChange={(event) => setSearch(event.target.value)}
        />
      </Toolbar>
      {isBlocked(state) ? (
        <BoardState state={state} />
      ) : (
        <ListArea>
          <ListPane>
            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead className="mqs-col-fill">{t("board.ibmmq.channels.name")}</TableHead>
                  <TableHead>{t("board.ibmmq.channels.type")}</TableHead>
                  <TableHead>{t("board.ibmmq.channels.status")}</TableHead>
                  <TableHead className="num">{t("board.ibmmq.channels.instances")}</TableHead>
                  <TableHead className="num">{t("board.ibmmq.channels.messages")}</TableHead>
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
                        {entry.inDoubt && (
                          <Status tone="warn">{t("board.ibmmq.channels.inDoubtBadge")}</Status>
                        )}
                      </span>
                    </TableCell>
                    <TableCell>{t(`board.ibmmq.channels.group.${group(entry)}`)}</TableCell>
                    <TableCell className={cn(unhealthy(entry) && "text-(--c-warn-text)")}>
                      {statusOf(entry, t)}
                    </TableCell>
                    <TableCell className="num">{entry.instances}</TableCell>
                    <TableCell className="num">{count(metric(entry.messages))}</TableCell>
                  </TableRow>
                ))}
                {shown.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      {channels.length === 0
                        ? t("board.ibmmq.channels.none")
                        : t("board.common.noMatch")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ListPane>

          {current != null && (
            <ChannelSheet
              key={current.name}
              entry={current}
              onClose={() => setSelected(null)}
            />
          )}
        </ListArea>
      )}
      {!isBlocked(state) && (
        <StatusBar left={<span>{t("board.ibmmq.channels.note")}</span>} />
      )}
    </Page>
  );
}

export function ChannelSheet({ entry, onClose }: { entry: Channel; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <DetailPanel width={380} onDismiss={onClose}>
      <DetailPanelHeader title={entry.name} onClose={onClose} />
      <DetailPanelBody>
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label={t("board.ibmmq.channels.instances")} value={entry.instances} />
          <MiniStat
            label={t("board.ibmmq.channels.messages")}
            value={count(metric(entry.messages))}
          />
        </div>

        <div>
          <SectionLabel className="mb-1.5">{t("board.ibmmq.channels.section.definition")}</SectionLabel>
          <KV
            rows={[
              [t("board.ibmmq.channels.type"), entry.type],
              [t("board.ibmmq.channels.connectionName"), entry.connectionName || DASH],
              [t("board.ibmmq.channels.transmissionQueue"), entry.transmissionQueue || DASH],
              [t("board.ibmmq.channels.description"), entry.description || DASH],
            ]}
          />
        </div>

        <div>
          <SectionLabel className="mb-1.5">{t("board.ibmmq.channels.section.runtime")}</SectionLabel>
          <KV
            rows={[
              [t("board.ibmmq.channels.status"), statusOf(entry, t)],
              [t("board.ibmmq.channels.substate"), entry.substate || DASH],
              [t("board.ibmmq.channels.remoteQueueManager"), entry.remoteQueueManager || DASH],
              [t("board.ibmmq.channels.startedAt"), entry.startedAt || DASH],
              [t("board.ibmmq.channels.lastMessageAt"), entry.lastMessageAt || DASH],
              [t("board.ibmmq.channels.bytesSent"), count(metric(entry.bytesSent))],
              [t("board.ibmmq.channels.bytesReceived"), count(metric(entry.bytesReceived))],
            ]}
          />
        </div>

        {entry.inDoubt && (
          <p className="text-xs leading-relaxed text-(--c-warn-text)">
            {t("board.ibmmq.channels.inDoubtNote")}
          </p>
        )}
        {entry.stopRequested && (
          <p className="text-xs leading-relaxed text-(--c-warn-text)">
            {t("board.ibmmq.channels.stopRequestedNote")}
          </p>
        )}
      </DetailPanelBody>
    </DetailPanel>
  );
}
