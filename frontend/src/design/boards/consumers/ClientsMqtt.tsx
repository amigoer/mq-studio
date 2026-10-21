import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Unplug } from "lucide-react";
import { ListArea, ListPane, Page, PageHeader, RefreshButton, Toolbar } from "@/design/shell";
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
  SectionLabel,
  Status,
  WarnBanner,
  useConfirm,
} from "@/components";
import { BoardState, isBlocked } from "@/design/boards/BoardState";
import { useMqttClients } from "@/hooks/mqtt/useMqttBroker";
import { clientSession, isOrphanedSession, type MqttClientSession } from "@/mq/mqtt/clients";
import { kickMqttClient } from "@/api/mqtt";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { formatBytes, formatCount } from "@/lib/format";
import { formatErrorMessage } from "@/lib/utils";
import type { ClientConnection } from "@/api/models";

function reported(value: number | null): string {
  return value == null ? "—" : formatCount(value);
}

/**
 * Board 11c — MQTT clients and sessions.
 *
 * A row here is a session rather than a socket, and that distinction is what
 * the page exists for. An MQTT session can outlive the connection that made
 * it: with clean start off and a session expiry set, the broker keeps queueing
 * messages for a client that is not there, and nothing on the device's side
 * shows it. Those rows are the ones worth finding, so they are marked.
 *
 * The whole page needs a management API. MQTT itself cannot enumerate who is
 * connected - there is no protocol surface for it at all - so on a Mosquitto
 * this entry is drawn disabled with the reason rather than showing an empty
 * table, which would say nobody is connected.
 */
export function ClientsMqtt() {
  const { t } = useTranslation();
  const state = useMqttClients();
  const confirm = useConfirm();
  const { id: connID } = useConnectionScope();

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clients = useMemo(() => state.data ?? [], [state.data]);
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === "") return clients;
    return clients.filter(
      (client) =>
        client.name.toLowerCase().includes(needle) ||
        client.peerHost.toLowerCase().includes(needle) ||
        client.user.toLowerCase().includes(needle),
    );
  }, [clients, search]);

  const current = shown.find((client) => client.name === selected) ?? null;

  const orphaned = useMemo(() => clients.filter(isOrphanedSession).length, [clients]);

  const kick = async (client: ClientConnection) => {
    const ok = await confirm({
      title: t("board.consumers.mqtt.kickTitle", { client: client.name }),
      /* Most clients reconnect at once, so this is a nudge rather than an
         eviction - and on a persistent session it also leaves the queued
         messages behind, which is usually the point of doing it. */
      description: t("board.consumers.mqtt.kickDesc"),
      confirmLabel: t("board.consumers.mqtt.kick"),
      danger: true,
    });
    if (!ok || connID === 0) return;
    try {
      await kickMqttClient(connID, client.name);
      await state.refresh();
    } catch (cause: unknown) {
      setError(formatErrorMessage(cause));
    }
  };

  return (
    <Page>
      <PageHeader
        title={t("board.consumers.mqtt.title")}
        subtitle={t("board.consumers.mqtt.count", {
          total: clients.length,
          orphaned,
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
          placeholder={t("board.consumers.mqtt.search")}
          onChange={(event) => setSearch(event.target.value)}
        />
      </Toolbar>
      {isBlocked(state) ? (
        <BoardState state={state} />
      ) : (
        <>
          {error != null && <WarnBanner style={{ marginBlock: "12px" }}>{error}</WarnBanner>}
          <ListArea>
            <ListPane>
              <Table inset>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client ID</TableHead>
                    <TableHead>{t("board.consumers.mqtt.user")}</TableHead>
                    <TableHead>{t("board.consumers.mqtt.address")}</TableHead>
                    <TableHead>{t("board.common.protocol")}</TableHead>
                    <TableHead className="num">{t("board.consumers.mqtt.subsCount")}</TableHead>
                    <TableHead>{t("board.consumers.mqtt.state")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((client) => {
                    const session = clientSession(client);
                    return (
                      <TableRow
                        key={client.name}
                        selected={selected === client.name}
                        onClick={() => setSelected(client.name)}
                      >
                        <TableCell className="select-text">{client.name}</TableCell>
                        <TableCell>{client.user === "" ? "—" : client.user}</TableCell>
                        <TableCell className="mono3 text-xs">
                          {client.peerHost}:{client.peerPort}
                        </TableCell>
                        <TableCell>{client.protocol}</TableCell>
                        <TableCell className="num">{reported(session.subscriptions)}</TableCell>
                        <TableCell>
                          <SessionState session={session} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {shown.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        {clients.length === 0
                          ? t("board.consumers.mqtt.none")
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
                client={current}
                onKick={() => void kick(current)}
                onClose={() => setSelected(null)}
              />
            )}
          </ListArea>
        </>
      )}
    </Page>
  );
}

function SessionState({ session }: { session: MqttClientSession }) {
  const { t } = useTranslation();
  return session.connected ? (
    <Status tone="ok">{t("board.consumers.mqtt.online")}</Status>
  ) : (
    // A session with nobody on it, still queueing.
    <Status tone="warn">{t("board.consumers.mqtt.offlinePersistent")}</Status>
  );
}

function ClientSheet({
  client,
  onKick,
  onClose,
}: {
  client: ClientConnection;
  onKick: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const session = clientSession(client);
  return (
    <DetailPanel width={380} onDismiss={onClose}>
      <DetailPanelHeader
        title={client.name}
        badge={<SessionState session={session} />}
        onClose={onClose}
      />
      <DetailPanelBody>
        <div className="grid grid-cols-2 gap-2">
          <MiniStat
            label={t("board.consumers.mqtt.inflightQueued")}
            value={`${reported(session.inflight)} / ${reported(session.queued)}`}
          />
          {/* A broker that gave up queueing for a client drops the messages
              silently; this is the only place it shows. */}
          <MiniStat
            label={t("board.consumers.mqtt.queueDropped")}
            value={reported(session.queueDropped)}
          />
        </div>

        <div>
          <SectionLabel className="mb-1.5">{t("board.consumers.mqtt.session")}</SectionLabel>
          <KV
            rows={[
              [t("board.consumers.mqtt.keepAlive"), `${client.heartbeatSec}s`],
              [t("board.consumers.mqtt.cleanStart"), String(session.cleanStart)],
              [t("board.consumers.mqtt.expiry"), reported(session.sessionExpirySec)],
              [t("board.consumers.mqtt.listener"), session.listener],
            ]}
          />
        </div>

        <div>
          <SectionLabel className="mb-1.5">{t("board.consumers.mqtt.stats")}</SectionLabel>
          <KV
            rows={[
              [
                t("board.consumers.mqtt.rxTx"),
                `${formatBytes(client.recvBytes)} / ${formatBytes(client.sendBytes)}`,
              ],
            ]}
          />
        </div>
      </DetailPanelBody>
      <DetailPanelFooter>
        <span className="flex-1" />
        <Button variant="destructive" onClick={onKick}>
          <Unplug aria-hidden />
          {t("board.consumers.mqtt.kick")}
        </Button>
      </DetailPanelFooter>
    </DetailPanel>
  );
}
