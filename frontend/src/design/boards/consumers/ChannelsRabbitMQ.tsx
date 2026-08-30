import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
  Panel,
  ProtoBadge,
  SectionLabel,
  Status,
  toast,
  useConfirm,
} from "@/components";
import { BoardState, isBlocked } from "@/design/boards/BoardState";
import { useRabbitClients } from "@/hooks/rabbitmq/useRabbitClients";
import { formatBytes, formatCount } from "@/lib/format";
import { useConnectionScope } from "@/mq/ConnectionScope";
import * as rabbitApi from "@/api/rabbitmq";
import { formatErrorMessage } from "@/lib/utils";
import type { ClientChannel, ClientConnection } from "@/api/rabbitmq";

const TAG = { fontSize: "10px" } as const;
const MONO11 = { fontSize: "11px" } as const;

/**
 * Board 4c - RabbitMQ connections and channels.
 *
 * There is no consumer group in AMQP, so the canonical consumers page has no
 * counterpart here. What an operator looks at instead is the transport: which
 * hosts are holding sockets open, which of them the broker has stopped
 * accepting publishes from, and which channels are sitting on unacknowledged
 * work.
 *
 * Channels rather than consumers is the level that matters. Prefetch and
 * unacknowledged counts are per channel, and a consumer that has stopped
 * acknowledging shows here long before the queue depth makes it obvious.
 */
export function ChannelsRabbitMQ() {
  const { t } = useTranslation();
  const state = useRabbitClients();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const connections = useMemo(() => state.data?.connections ?? [], [state.data]);
  const channels = useMemo(() => state.data?.channels ?? [], [state.data]);

  const channelsByConnection = useMemo(() => {
    const byConnection = new Map<string, ClientChannel[]>();
    for (const channel of channels) {
      const existing = byConnection.get(channel.connection);
      if (existing) existing.push(channel);
      else byConnection.set(channel.connection, [channel]);
    }
    return byConnection;
  }, [channels]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return connections
      .filter(
        (connection) =>
          needle === "" ||
          connection.name.toLowerCase().includes(needle) ||
          connection.clientName.toLowerCase().includes(needle) ||
          connection.user.toLowerCase().includes(needle),
      )
      .sort((left, right) => unackedOn(right, channelsByConnection) - unackedOn(left, channelsByConnection));
  }, [channelsByConnection, connections, search]);

  const detail = useMemo(
    () => rows.find((connection) => connection.name === selected) ?? null,
    [rows, selected],
  );

  const stalled = channels.filter((channel) => channel.flowBlocked).length;

  const close = useCallback(
    async (connection: ClientConnection, everyOne: boolean) => {
      const own = channelsByConnection.get(connection.name) ?? [];
      const ok = await confirm({
        title: everyOne
          ? t("board.consumers.rabbitmq.closeUserTitle", { user: connection.user })
          : t("board.consumers.rabbitmq.closeTitle", { peer: connection.peerHost }),
        /* Closing a connection closes every channel inside it, and most
           clients reconnect at once - so this is a nudge, not an eviction,
           unless whatever is reconnecting has also been stopped. */
        description: everyOne
          ? t("board.consumers.rabbitmq.closeUserDesc")
          : t("board.consumers.rabbitmq.closeDesc", { count: own.length }),
        confirmLabel: t("board.consumers.rabbitmq.close"),
        danger: true,
      });
      if (!ok) return;
      try {
        if (everyOne) {
          await rabbitApi.closeUserConnections(connID, connection.user, closeReason(t));
        } else {
          await rabbitApi.closeClientConnection(connID, connection.name, closeReason(t));
        }
        toast.success(t("board.consumers.rabbitmq.closed"));
        setSelected(null);
        await state.refresh();
      } catch (closeError) {
        toast.error(t("board.consumers.rabbitmq.closeFailed"), {
          description: formatErrorMessage(closeError),
        });
      }
    },
    [channelsByConnection, confirm, connID, state, t],
  );

  return (
    <Page>
      <PageHeader
        title={t("board.consumers.rabbitmq.title")}
        subtitle={t("board.consumers.rabbitmq.subtitle", {
          connections: connections.length,
          channels: channels.length,
        })}
        actions={
          <RefreshButton
            refreshing={state.refreshing}
            online={state.online}
            onClick={state.refresh}
          />
        }
      />
      {!isBlocked(state) && (
        <Toolbar>
          <Input
            className="w-[260px] flex-none"
            placeholder={t("board.consumers.rabbitmq.search")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <span className="flex-1" />
          {/* Flow control is the broker telling a publisher to slow down. It
              is the reason a producer mysteriously stalls, so it is worth
              saying at the top rather than only in a row. */}
          {stalled > 0 && (
            <span style={{ fontSize: "11.5px", color: "var(--c-warn-text)" }}>
              {t("board.consumers.rabbitmq.stallWarn", { count: stalled })}
            </span>
          )}
        </Toolbar>
      )}
      <ListArea>
        <ListPane>
          <BoardState
            state={state}
            empty={connections.length === 0 ? t("board.consumers.rabbitmq.none") : undefined}
          >
            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("board.common.client")}</TableHead>
                  <TableHead>{t("board.common.user")}</TableHead>
                  <TableHead>{t("board.consumers.rabbitmq.protocol")}</TableHead>
                  <TableHead style={{ textAlign: "right" }}>
                    {t("board.common.channel")}
                  </TableHead>
                  <TableHead style={{ textAlign: "right" }}>Unacked</TableHead>
                  <TableHead style={{ textAlign: "right" }}>
                    {t("board.consumers.rabbitmq.rxTx")}
                  </TableHead>
                  <TableHead>{t("board.common.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((connection) => {
                  const own = channelsByConnection.get(connection.name) ?? [];
                  const unacked = own.reduce((total, channel) => total + channel.unacknowledged, 0);
                  const blocked = own.some((channel) => channel.flowBlocked);
                  return (
                    <TableRow
                      key={connection.name}
                      selected={selected === connection.name}
                      onClick={() => setSelected(connection.name)}
                    >
                      <TableCell>
                        <b style={{ fontWeight: 500 }}>
                          {connection.clientName !== ""
                            ? connection.clientName
                            : connection.peerHost}
                        </b>
                        <span
                          className="mono3"
                          style={{ marginLeft: "6px", fontSize: "10.5px", color: "var(--c-muted)" }}
                        >
                          {connection.peerHost}:{connection.peerPort}
                        </span>
                      </TableCell>
                      <TableCell>{connection.user}</TableCell>
                      <TableCell className="mono3" style={MONO11}>
                        {connection.protocol}
                      </TableCell>
                      <TableCell className="mono3" style={{ textAlign: "right" }}>
                        {formatCount(connection.channels)}
                      </TableCell>
                      <TableCell
                        className="mono3"
                        style={{
                          textAlign: "right",
                          color: unacked > 0 ? "var(--c-warn-text)" : undefined,
                        }}
                      >
                        {formatCount(unacked)}
                      </TableCell>
                      <TableCell className="mono3" style={{ textAlign: "right" }}>
                        {formatBytes(connection.recvByteRate)}/s /{" "}
                        {formatBytes(connection.sendByteRate)}/s
                      </TableCell>
                      <TableCell>
                        <ConnectionTone connection={connection} flowBlocked={blocked} />
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length === 0 && connections.length > 0 && (
                  <TableRow>
                    <TableCell colSpan={7} style={{ color: "var(--c-muted)" }}>
                      {t("board.consumers.rabbitmq.noMatch")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </BoardState>
        </ListPane>

        {detail != null && (
          <DetailPanel width={400} onDismiss={() => setSelected(null)}>
            <DetailPanelHeader
              title={detail.clientName !== "" ? detail.clientName : detail.peerHost}
              badge={<ProtoBadge protocol="rabbitmq" label={detail.protocol} />}
              onClose={() => setSelected(null)}
            />
            <DetailPanelBody>
              <ConnectionDetail
                connection={detail}
                channels={channelsByConnection.get(detail.name) ?? []}
              />
            </DetailPanelBody>
            <DetailPanelFooter>
              <Button variant="outline" onClick={() => void close(detail, true)}>
                {t("board.consumers.rabbitmq.closeUser")}
              </Button>
              <span className="flex-1" />
              <Button variant="destructive" onClick={() => void close(detail, false)}>
                {t("board.consumers.rabbitmq.close")}
              </Button>
            </DetailPanelFooter>
          </DetailPanel>
        )}
      </ListArea>
    </Page>
  );
}

/**
 * What the client is told, and what the broker logs.
 *
 * Naming the app is the point: an application that suddenly loses its
 * connection can then find out from its own logs who did it, rather than
 * seeing a bare "connection forced" that nobody can explain.
 */
function closeReason(t: (key: string) => string): string {
  return t("board.consumers.rabbitmq.closeReason");
}

function unackedOn(
  connection: ClientConnection,
  byConnection: Map<string, ClientChannel[]>,
): number {
  const own = byConnection.get(connection.name) ?? [];
  return own.reduce((total, channel) => total + channel.unacknowledged, 0);
}

/**
 * What the connection is doing, worst first.
 *
 * Blocked outranks flow control: the broker has stopped this connection
 * publishing entirely because a resource alarm is on, which is a cluster
 * problem rather than a client one.
 */
function ConnectionTone({
  connection,
  flowBlocked,
}: {
  connection: ClientConnection;
  flowBlocked: boolean;
}) {
  const { t } = useTranslation();
  if (connection.state === "blocked" || connection.blockedBy !== "") {
    return (
      <Status tone="err">
        {t("board.consumers.rabbitmq.blocked", { reason: connection.blockedBy || "resource" })}
      </Status>
    );
  }
  if (flowBlocked) {
    return <Status tone="warn">{t("board.consumers.rabbitmq.flow")}</Status>;
  }
  return <Status tone="ok">{connection.state || "running"}</Status>;
}

function ConnectionDetail({
  connection,
  channels,
}: {
  connection: ClientConnection;
  channels: ClientChannel[];
}) {
  const { t } = useTranslation();

  return (
    <>
      <KV
        rows={[
          [t("board.common.user"), connection.user],
          [t("board.common.node"), <span key="n" className="mono3" style={MONO11}>{connection.node}</span>],
          [
            t("board.consumers.rabbitmq.peer"),
            <span key="p" className="mono3" style={MONO11}>
              {connection.peerHost}:{connection.peerPort}
            </span>,
          ],
          [t("board.consumers.rabbitmq.protocol"), connection.protocol],
          [
            "TLS",
            connection.tls
              ? connection.cipher || t("board.consumers.rabbitmq.tlsOn")
              : t("board.consumers.rabbitmq.tlsOff"),
          ],
          [
            t("board.consumers.rabbitmq.heartbeat"),
            /* Zero means heartbeats are off, which is worth saying rather than
               printing "0s": such a connection can sit half-open through a
               partition and look healthy from both ends. */
            connection.heartbeatSec > 0
              ? `${connection.heartbeatSec}s`
              : t("board.consumers.rabbitmq.heartbeatOff"),
          ],
          [
            t("board.consumers.rabbitmq.transferred"),
            `${formatBytes(connection.recvBytes)} / ${formatBytes(connection.sendBytes)}`,
          ],
        ]}
      />

      <div>
        <SectionLabel style={{ marginBottom: "6px" }}>
          {t("board.consumers.rabbitmq.channelsOn", { count: channels.length })}
        </SectionLabel>
        <Panel
          style={{
            padding: "9px 12px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            fontSize: "11.5px",
          }}
        >
          {channels.map((channel) => (
            <ChannelRow key={channel.name} channel={channel} />
          ))}
          {channels.length === 0 && (
            <span style={{ color: "var(--c-muted)" }}>
              {t("board.consumers.rabbitmq.noChannels")}
            </span>
          )}
          {/* There is no endpoint to close one channel: the broker offers
              only whole connections, and a button that said otherwise would
              close more than it named. */}
          {channels.length > 0 && (
            <span style={{ color: "var(--c-muted)", fontSize: "10.5px" }}>
              {t("board.consumers.rabbitmq.noChannelClose")}
            </span>
          )}
        </Panel>
      </div>
    </>
  );
}

function ChannelRow({ channel }: { channel: ClientChannel }) {
  const { t } = useTranslation();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
        <span className="mono3" style={MONO11}>
          #{channel.number}
        </span>
        {channel.flowBlocked && (
          <Status tone="warn" style={TAG}>
            {t("board.consumers.rabbitmq.flow")}
          </Status>
        )}
        {/* Confirms and transactions are the two delivery guarantees a channel
            can be in, and AMQP makes them mutually exclusive. */}
        {channel.confirms && (
          <Status tone="off" style={TAG}>
            confirms
          </Status>
        )}
        {channel.transactional && (
          <Status tone="off" style={TAG}>
            tx
          </Status>
        )}
      </div>
      <span style={{ color: "var(--c-mono-dim)" }}>
        {t("board.consumers.rabbitmq.channelLine", {
          consumers: channel.consumers,
          prefetch: channel.prefetchCount,
          unacked: channel.unacknowledged,
          unconfirmed: channel.unconfirmed,
        })}
      </span>
      {channel.idleSince !== "" && (
        <span style={{ color: "var(--c-muted)" }}>
          {t("board.consumers.rabbitmq.idleSince", { since: channel.idleSince })}
        </span>
      )}
    </div>
  );
}
