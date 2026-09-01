import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Unplug } from "lucide-react";
import { Page, PageBody, PageHeader, RefreshButton } from "@/design/shell";
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
import { KV, Panel, PanelHeader, SectionLabel, Status, WarnBanner, useConfirm } from "@/components";
import { BoardState } from "@/design/boards/BoardState";
import { useMqttClients } from "@/hooks/mqtt/useMqttBroker";
import { clientSession, isOrphanedSession } from "@/mq/mqtt/clients";
import { kickMqttClient } from "@/api/mqtt";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { formatBytes, formatCount } from "@/lib/format";
import { formatErrorMessage } from "@/lib/utils";
import type { ClientConnection } from "@/api/models";

const MONO11 = { fontSize: "11px" } as const;

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

  const detail = useMemo(
    () => shown.find((client) => client.name === selected) ?? shown[0] ?? null,
    [shown, selected],
  );

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
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <Input
              style={{ width: "200px" }}
              value={search}
              placeholder={t("board.consumers.mqtt.search")}
              onChange={(event) => setSearch(event.target.value)}
            />
            <RefreshButton
              refreshing={state.refreshing}
              online={state.online}
              onClick={() => void state.refresh()}
            />
          </div>
        }
      />
      <BoardState state={state}>
        <PageBody>
          {error != null && <WarnBanner>{error}</WarnBanner>}
          <div style={{ display: "flex", gap: "12px", minHeight: 0, flex: 1 }}>
            <Panel style={{ flex: 1, minWidth: 0 }}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client ID</TableHead>
                    <TableHead>{t("board.consumers.mqtt.user")}</TableHead>
                    <TableHead>{t("board.consumers.mqtt.address")}</TableHead>
                    <TableHead>{t("board.common.protocol")}</TableHead>
                    <TableHead>{t("board.consumers.mqtt.subsCount")}</TableHead>
                    <TableHead>{t("board.consumers.mqtt.state")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((client) => {
                    const session = clientSession(client);
                    return (
                      <TableRow
                        key={client.name}
                        onClick={() => setSelected(client.name)}
                        aria-selected={detail?.name === client.name}
                      >
                        <TableCell className="mono3" style={MONO11}>
                          {client.name}
                        </TableCell>
                        <TableCell>{client.user === "" ? "—" : client.user}</TableCell>
                        <TableCell className="mono3" style={MONO11}>
                          {client.peerHost}:{client.peerPort}
                        </TableCell>
                        <TableCell style={MONO11}>{client.protocol}</TableCell>
                        <TableCell className="mono3" style={MONO11}>
                          {reported(session.subscriptions)}
                        </TableCell>
                        <TableCell>
                          {session.connected ? (
                            <Status tone="ok">{t("board.consumers.mqtt.online")}</Status>
                          ) : (
                            // A session with nobody on it, still queueing.
                            <Status tone="warn">
                              {t("board.consumers.mqtt.offlinePersistent")}
                            </Status>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Panel>

            <Panel style={{ width: "300px", flex: "none" }}>
              <PanelHeader
                title={t("board.consumers.mqtt.session")}
                action={
                  detail != null && (
                    <Button variant="outline" onClick={() => void kick(detail)}>
                      <Unplug size={14} aria-hidden />
                      {t("board.consumers.mqtt.kick")}
                    </Button>
                  )
                }
              />
              {detail == null ? (
                <div style={{ padding: "14px", fontSize: "12px", color: "var(--c-muted)" }}>
                  {t("board.consumers.mqtt.noClients")}
                </div>
              ) : (
                <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "10px" }}>
                  <SectionLabel>{t("board.consumers.mqtt.session")}</SectionLabel>
                  <KV
                    rows={[
                      ["Client ID", detail.name],
                      [t("board.consumers.mqtt.keepAlive"), `${detail.heartbeatSec}s`],
                      [
                        t("board.consumers.mqtt.cleanStart"),
                        String(clientSession(detail).cleanStart),
                      ],
                      [
                        t("board.consumers.mqtt.expiry"),
                        reported(clientSession(detail).sessionExpirySec),
                      ],
                      [t("board.consumers.mqtt.listener"), clientSession(detail).listener],
                    ]}
                  />
                  <SectionLabel>{t("board.consumers.mqtt.stats")}</SectionLabel>
                  <KV
                    rows={[
                      [
                        t("board.consumers.mqtt.inflightQueued"),
                        `${reported(clientSession(detail).inflight)} / ${reported(
                          clientSession(detail).queued,
                        )}`,
                      ],
                      // A broker that gave up queueing for a client drops the
                      // messages silently; this is the only place it shows.
                      [
                        t("board.consumers.mqtt.queueDropped"),
                        reported(clientSession(detail).queueDropped),
                      ],
                      [
                        t("board.consumers.mqtt.rxTx"),
                        `${formatBytes(detail.recvBytes)} / ${formatBytes(detail.sendBytes)}`,
                      ],
                    ]}
                  />
                </div>
              )}
            </Panel>
          </div>
        </PageBody>
      </BoardState>
    </Page>
  );
}
