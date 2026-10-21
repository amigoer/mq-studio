import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
  SectionLabel,
  useConfirm,
} from "@/components";
import { BoardState, isBlocked } from "@/design/boards/BoardState";
import { useActiveMQConnections } from "@/hooks/activemq/useActiveMQCluster";
import {
  connection as readConnection,
  type ActiveMQConnection,
} from "@/mq/activemq/cluster";
import { formatCount } from "@/lib/format";
import { formatErrorMessage } from "@/lib/utils";
import { useConnectionScope } from "@/mq/ConnectionScope";
import * as activemqApi from "@/api/activemq";

const DASH = "—";

/**
 * ActiveMQ connections.
 *
 * The sessions column is not a channel count, and the distinction matters
 * enough to keep the wording apart. A channel is AMQP 0-9-1's multiplexing
 * layer with its own prefetch and its own flow control, and an operator closes
 * one. A JMS session has none of that: it is a unit of work inside the
 * connection, it cannot be closed from outside, and there is no separate page
 * for them here because there would be nothing to do on it.
 *
 * The protocol column is read differently on each product and both are the
 * broker's own answer. Artemis reports the connection's Java class, mapped to
 * the protocol's name - the raw ActiveMQProtonRemotingConnection is not
 * something to put in a column. Classic reports which connector accepted the
 * socket, which is the same fact from the other side.
 */
export function ClientsActiveMQ() {
  const { t } = useTranslation();
  const state = useActiveMQConnections();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const connections = useMemo(
    () => (state.data ?? []).map(readConnection),
    [state.data],
  );
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === "") return connections;
    return connections.filter(
      (entry) =>
        entry.peer.toLowerCase().includes(needle) ||
        entry.user.toLowerCase().includes(needle) ||
        entry.clientName.toLowerCase().includes(needle),
    );
  }, [connections, search]);

  const current = shown.find((entry) => entry.name === selected) ?? null;

  const close = useCallback(
    async (entry: ActiveMQConnection) => {
      const ok = await confirm({
        title: t("board.activemq.clients.closeTitle", { peer: entry.peer }),
        description: t("board.activemq.clients.closeDesc"),
        confirmLabel: t("board.activemq.clients.close"),
        danger: true,
      });
      if (!ok) return;
      try {
        await activemqApi.closeConnection(connID, entry.name);
        toast.success(t("board.activemq.clients.closed", { peer: entry.peer }));
        setSelected(null);
        await state.refresh();
      } catch (closeError) {
        toast.error(t("board.activemq.clients.closeFailed"), {
          description: formatErrorMessage(closeError),
        });
      }
    },
    [confirm, connID, state, t],
  );

  return (
    <Page>
      <PageHeader
        title={t("shell.nav.activemq.clients")}
        subtitle={t("board.activemq.clients.count", { count: connections.length })}
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
          placeholder={t("board.activemq.clients.search")}
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
                  <TableHead>{t("board.activemq.clients.peer")}</TableHead>
                  <TableHead>{t("board.activemq.clients.protocol")}</TableHead>
                  <TableHead>{t("board.activemq.clients.user")}</TableHead>
                  <TableHead>{t("board.activemq.clients.state")}</TableHead>
                  <TableHead className="num">{t("board.activemq.clients.sessions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((entry) => (
                  <TableRow
                    key={entry.name}
                    selected={selected === entry.name}
                    onClick={() => setSelected(entry.name)}
                  >
                    <TableCell className="mono3 text-xs">{entry.peer}</TableCell>
                    <TableCell>{entry.protocol === "" ? DASH : entry.protocol}</TableCell>
                    <TableCell className="select-text">
                      {entry.user === "" ? DASH : entry.user}
                    </TableCell>
                    <TableCell>
                      {entry.blocked === true
                        ? t("board.activemq.clients.blocked")
                        : entry.slow === true
                          ? t("board.activemq.clients.slow")
                          : t("board.activemq.clients.running")}
                    </TableCell>
                    <TableCell className="num">{formatCount(entry.sessions)}</TableCell>
                  </TableRow>
                ))}
                {shown.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      {connections.length === 0
                        ? t("board.activemq.clients.none")
                        : t("board.common.noMatch")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ListPane>

          {current != null && (
            <ConnectionSheet
              key={current.name}
              entry={current}
              onClose={() => setSelected(null)}
              onDisconnect={() => void close(current)}
            />
          )}
        </ListArea>
      )}
      {!isBlocked(state) && (
        <StatusBar left={<span>{t("board.activemq.clients.sessionNote")}</span>} />
      )}
    </Page>
  );
}

function ConnectionSheet({
  entry,
  onClose,
  onDisconnect,
}: {
  entry: ActiveMQConnection;
  onClose: () => void;
  onDisconnect: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DetailPanel width={380} onDismiss={onClose}>
      <DetailPanelHeader title={entry.peer} onClose={onClose} />
      <DetailPanelBody>
        <div>
          <SectionLabel className="mb-1.5">
            {t("board.activemq.clients.section.identity")}
          </SectionLabel>
          <KV
            rows={[
              [t("board.activemq.clients.connectionId"), entry.name],
              [
                t("board.activemq.clients.clientId"),
                entry.clientName === "" ? DASH : entry.clientName,
              ],
              [t("board.activemq.clients.user"), entry.user === "" ? DASH : entry.user],
              [t("board.activemq.clients.protocol"), entry.protocol || DASH],
              // Classic's is the connector that accepted the socket,
              // which is where its protocol comes from; Artemis has no
              // connector on a connection and this is blank.
              [t("board.activemq.clients.connector"), entry.connector ?? DASH],
              [t("board.activemq.clients.created"), entry.created ?? DASH],
              [t("board.activemq.clients.sessions"), formatCount(entry.sessions)],
            ]}
          />
        </div>
      </DetailPanelBody>
      <DetailPanelFooter>
        <span className="flex-1" />
        <Button variant="destructive" onClick={onDisconnect}>
          {t("board.activemq.clients.close")}
        </Button>
      </DetailPanelFooter>
    </DetailPanel>
  );
}
