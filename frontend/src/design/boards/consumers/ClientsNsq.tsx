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
  OutlineTag,
  SectionLabel,
  Status,
} from "@/components";
import { BoardState, isBlocked } from "@/design/boards/BoardState";
import { useNsqConnections } from "@/hooks/nsq/useNsqCluster";
import { askingForNothing, client as readClient, type NsqClient } from "@/mq/nsq/clients";
import { formatCount } from "@/lib/format";

/** A dash, not a zero: an absent figure and a measured zero are not alike. */
const DASH = "—";

function count(value: number | null): string {
  return value == null ? DASH : formatCount(value);
}

/**
 * Who is connected, in the two roles nsqd reports them in.
 *
 * A consumer and a producer are found in different places and carry different
 * figures, so the role is a column rather than a detail: a consumer has a
 * channel and a ready count, a producer has neither and instead reports what
 * it has published per topic. A producer with no ready count is not a stalled
 * consumer, and the page must not read like it is.
 *
 * The ready count is still the column that earns the page. It is what a
 * consumer told nsqd it will accept, and a zero means it is connected, holding
 * its channel, and asking for nothing - a backlog that will not move however
 * healthy every other figure looks. Nothing else in this app can see that.
 *
 * One client process shows up once per daemon it found, which is not
 * duplication: those are separate connections holding separate messages.
 *
 * Anything publishing over HTTP is absent, and no page can fix it: /pub is a
 * request rather than a connection, so nsqd has nothing left to list once it
 * has answered.
 */
export function ClientsNsq() {
  const { t } = useTranslation();
  const state = useNsqConnections();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const clients = useMemo(() => (state.data ?? []).map(readClient), [state.data]);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === "") return clients;
    return clients.filter((entry) =>
      [entry.clientId, entry.peer, entry.topic, entry.channel, entry.node].some((field) =>
        field.toLowerCase().includes(needle),
      ),
    );
  }, [clients, search]);

  const current = shown.find((entry) => entry.id === selected) ?? null;

  return (
    <Page>
      <PageHeader
        title={t("shell.nav.nsq.clients")}
        subtitle={t("board.nsq.clients.count", { count: clients.length })}
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
          className="w-72 flex-none"
          value={search}
          placeholder={t("board.nsq.clients.search")}
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
                  <TableHead className="mqs-col-fill">{t("board.nsq.clients.peer")}</TableHead>
                  <TableHead className="mqs-col-secondary">{t("board.nsq.clients.roleColumn")}</TableHead>
                  <TableHead>{t("board.nsq.clients.topic")}</TableHead>
                  <TableHead>{t("board.nsq.clients.channel")}</TableHead>
                  <TableHead className="mqs-col-secondary num">{t("board.nsq.clients.ready")}</TableHead>
                  <TableHead className="num">{t("board.nsq.clients.inFlight")}</TableHead>
                  <TableHead className="mqs-col-secondary num">{t("board.nsq.clients.finished")}</TableHead>
                  <TableHead className="mqs-col-secondary">{t("board.nsq.clients.node")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((entry) => (
                  <TableRow
                    key={entry.id}
                    selected={selected === entry.id}
                    onClick={() => setSelected(entry.id)}
                  >
                    <TableCell className="mqs-col-fill">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="mono3 truncate text-xs">{entry.peer}</span>
                        {askingForNothing(entry) && (
                          <Status tone="warn">{t("board.nsq.clients.notReadyBadge")}</Status>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="mqs-col-secondary">{t(`board.nsq.clients.role.${entry.role}`)}</TableCell>
                    <TableCell className="select-text">{entry.topic || DASH}</TableCell>
                    <TableCell className="select-text">{entry.channel || DASH}</TableCell>
                    <TableCell className="mqs-col-secondary num">{count(entry.ready)}</TableCell>
                    <TableCell className="num">{count(entry.inFlight)}</TableCell>
                    <TableCell className="mqs-col-secondary num">{count(entry.finished)}</TableCell>
                    <TableCell className="mqs-col-secondary mono3 text-xs">{entry.node}</TableCell>
                  </TableRow>
                ))}
                {shown.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                      {clients.length === 0
                        ? t("board.nsq.clients.none")
                        : t("board.common.noMatch")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ListPane>

          {current != null && (
            <ClientSheet key={current.id} entry={current} onClose={() => setSelected(null)} />
          )}
        </ListArea>
      )}
      {!isBlocked(state) && <StatusBar left={<span>{t("board.nsq.clients.note")}</span>} />}
    </Page>
  );
}

export function ClientSheet({ entry, onClose }: { entry: NsqClient; onClose: () => void }) {
  const { t } = useTranslation();
  const producer = entry.role === "producer";
  return (
    <DetailPanel width={380} onDismiss={onClose}>
      <DetailPanelHeader
        title={entry.peer}
        badge={<OutlineTag>{t(`board.nsq.clients.role.${entry.role}`)}</OutlineTag>}
        onClose={onClose}
      />
      <DetailPanelBody>
        <div className="grid grid-cols-2 gap-2">
          {producer ? (
            <MiniStat label={t("board.nsq.clients.messages")} value={count(entry.messages)} />
          ) : (
            <>
              <MiniStat label={t("board.nsq.clients.ready")} value={count(entry.ready)} />
              <MiniStat label={t("board.nsq.clients.inFlight")} value={count(entry.inFlight)} />
            </>
          )}
        </div>

        {askingForNothing(entry) && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("board.nsq.clients.notReady")}
          </p>
        )}

        <div>
          <SectionLabel className="mb-1.5">{t("board.nsq.clients.section.identity")}</SectionLabel>
          <KV
            rows={[
              [t("board.nsq.clients.clientId"), entry.clientId || DASH],
              [t("board.nsq.clients.hostname"), entry.hostname || DASH],
              [t("board.nsq.clients.userAgent"), entry.userAgent || DASH],
              [t("board.nsq.clients.protocol"), entry.protocol],
              [t("board.nsq.clients.state"), entry.state],
              [
                t("board.nsq.clients.connectedAt"),
                entry.connectedAtMs > 0 ? new Date(entry.connectedAtMs).toLocaleString() : DASH,
              ],
            ]}
          />
        </div>

        <div>
          <SectionLabel className="mb-1.5">{t("board.nsq.clients.section.work")}</SectionLabel>
          <KV
            rows={
              producer
                ? [
                    [t("board.nsq.clients.node"), entry.node],
                    [t("board.nsq.clients.published"), entry.published || DASH],
                  ]
                : [
                    [t("board.nsq.clients.topic"), entry.topic],
                    [t("board.nsq.clients.channel"), entry.channel],
                    [t("board.nsq.clients.node"), entry.node],
                    [t("board.nsq.clients.messages"), count(entry.messages)],
                    [t("board.nsq.clients.finished"), count(entry.finished)],
                    [t("board.nsq.clients.requeued"), count(entry.requeued)],
                  ]
            }
          />
        </div>

        <div>
          <SectionLabel className="mb-1.5">{t("board.nsq.clients.section.transport")}</SectionLabel>
          <KV
            rows={[
              [t("board.nsq.clients.tls"), entry.tls ? t("common.yes") : t("common.no")],
              [t("board.nsq.clients.snappy"), entry.snappy ? t("common.yes") : t("common.no")],
            ]}
          />
        </div>
      </DetailPanelBody>
    </DetailPanel>
  );
}
