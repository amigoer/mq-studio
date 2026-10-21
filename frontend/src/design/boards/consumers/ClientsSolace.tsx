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
} from "@/components";
import { BoardState, isBlocked } from "@/design/boards/BoardState";
import { useSolaceClients } from "@/hooks/solace/useSolaceClients";
import { applications, client as readClient, type SolaceClient } from "@/mq/solace/clients";
import { formatBytes, formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

const DASH = "—";

function duration(seconds: number | null): string {
  if (seconds == null) return DASH;
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

/**
 * Who is connected to this Message VPN.
 *
 * The broker's own sessions are in the list and marked rather than filtered
 * out. They are real connections holding real resources - the internal message
 * bus, the REST listener's own session - and a page that hid them would
 * disagree with every count the broker reports. The header says how many of
 * the rows are applications, which is the number somebody actually came for.
 *
 * There is no protocol column, and its absence is the API rather than an
 * omission: SEMP reports nothing on a client that says whether it arrived over
 * SMF, MQTT, AMQP or REST. What it does report is the platform string the
 * client library sent, which is on the panel and is the closest thing to an
 * answer.
 *
 * The binds column is not a channel count. A Solace flow is per endpoint the
 * client is bound to rather than per session, it has no prefetch of its own,
 * and it is not something an operator closes - so there is no channels page
 * here and this column says "binds" instead.
 */
export function ClientsSolace() {
  const { t } = useTranslation();
  const state = useSolaceClients();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const clients = useMemo(() => (state.data ?? []).map(readClient), [state.data]);
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === "") return clients;
    return clients.filter(
      (entry) =>
        entry.name.toLowerCase().includes(needle) ||
        entry.address.toLowerCase().includes(needle) ||
        entry.username.toLowerCase().includes(needle),
    );
  }, [clients, search]);

  const current = shown.find((entry) => entry.name === selected) ?? null;

  return (
    <Page>
      <PageHeader
        title={t("shell.nav.solace.clients")}
        subtitle={t("board.solace.clients.count", {
          applications: applications(clients).length,
          total: clients.length,
        })}
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
          placeholder={t("board.solace.clients.search")}
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
                  <TableHead>{t("board.solace.clients.name")}</TableHead>
                  <TableHead>{t("board.solace.clients.address")}</TableHead>
                  <TableHead>{t("board.solace.clients.username")}</TableHead>
                  <TableHead className="num">{t("board.solace.clients.binds")}</TableHead>
                  <TableHead className="num">{t("board.solace.clients.uptime")}</TableHead>
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
                        <span
                          className={cn(
                            "truncate select-text",
                            entry.slowSubscriber && "text-(--c-warn-text)",
                          )}
                        >
                          {entry.name}
                        </span>
                        {entry.internal && (
                          <OutlineTag>{t("board.solace.clients.internalBadge")}</OutlineTag>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="mono3 text-xs">{entry.address}</TableCell>
                    <TableCell className="select-text">{entry.username || DASH}</TableCell>
                    <TableCell className="num">{formatCount(entry.binds)}</TableCell>
                    <TableCell className="num">{duration(entry.uptimeSec)}</TableCell>
                  </TableRow>
                ))}
                {shown.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      {clients.length === 0
                        ? t("board.solace.clients.none")
                        : t("board.common.noMatch")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ListPane>

          {current != null && (
            <ClientSheet
              key={current.name}
              entry={current}
              onClose={() => setSelected(null)}
            />
          )}
        </ListArea>
      )}
      {!isBlocked(state) && <StatusBar left={<span>{t("board.solace.clients.note")}</span>} />}
    </Page>
  );
}

export function ClientSheet({ entry, onClose }: { entry: SolaceClient; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <DetailPanel width={380} onDismiss={onClose}>
      <DetailPanelHeader title={entry.name} onClose={onClose} />
      <DetailPanelBody>
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label={t("board.solace.clients.binds")} value={formatCount(entry.binds)} />
          <MiniStat label={t("board.solace.clients.uptime")} value={duration(entry.uptimeSec)} />
        </div>

        <KV
          rows={[
            [t("board.solace.clients.msgVpn"), entry.msgVpn || DASH],
            [t("board.solace.clients.address"), entry.address],
            [t("board.solace.clients.username"), entry.username || DASH],
          ]}
        />

        <div>
          <SectionLabel className="mb-1.5">{t("board.solace.clients.section.library")}</SectionLabel>
          <KV
            rows={[
              [t("board.solace.clients.platform"), entry.platform ?? DASH],
              [t("board.solace.clients.softwareVersion"), entry.softwareVersion ?? DASH],
              [t("board.solace.clients.description"), entry.description ?? DASH],
            ]}
          />
        </div>

        <div>
          <SectionLabel className="mb-1.5">{t("board.solace.clients.section.limits")}</SectionLabel>
          <KV
            rows={[
              [t("board.solace.clients.clientProfile"), entry.clientProfile ?? DASH],
              [t("board.solace.clients.aclProfile"), entry.aclProfile ?? DASH],
              [t("board.solace.clients.recv"), formatBytes(entry.recvBytes)],
              [t("board.solace.clients.send"), formatBytes(entry.sendBytes)],
            ]}
          />
        </div>

        {entry.slowSubscriber && (
          <p className="text-xs leading-relaxed text-(--c-warn-text)">
            {t("board.solace.clients.slowNote")}
          </p>
        )}
        {entry.tlsDowngraded && (
          <p className="text-xs leading-relaxed text-(--c-warn-text)">
            {t("board.solace.clients.downgradedNote")}
          </p>
        )}
      </DetailPanelBody>
    </DetailPanel>
  );
}
