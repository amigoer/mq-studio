import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ListArea, ListPane, Page, PageHeader, RefreshButton, Toolbar } from "@/design/shell";
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
  Panel,
  SectionLabel,
  Status,
  WarnBanner,
} from "@/components";
import { BoardState } from "@/design/boards/BoardState";
import { useNatsCluster, useNatsServerConfig } from "@/hooks/nats/useNatsCluster";
import { formatBytes, formatCount } from "@/lib/format";
import type { Node } from "@bindings/model/models";
import {
  authRequired,
  connections,
  cores,
  cpuPercent,
  goVersion,
  hasJetStream,
  isFromOneServerOnly,
  isMetaLeader,
  jetStreamMemory,
  jetStreamStorage,
  leafNodes,
  maxConnections,
  maxPayload,
  memoryBytes,
  metaLeader,
  remotes,
  routes,
  serverId,
  slowConsumers,
  subscriptions,
  tlsRequired,
  totalConnections,
  uptime,
} from "@/mq/nats/cluster";

const MONO11 = { fontSize: "11px" } as const;
const RIGHT = { textAlign: "right" } as const;

function Metric({ value, format }: { value: number | null; format?: (value: number) => string }) {
  if (value == null) return <span style={{ color: "var(--c-muted-2)" }}>—</span>;
  return <>{format ? format(value) : formatCount(value)}</>;
}

/**
 * The servers this connection can reach.
 *
 * "Can reach" is the whole of what this board has to be careful about. NATS
 * offers two ways to ask about a server and they differ in reach rather than
 * in content: the monitoring endpoint answers for the single server whose port
 * the connection names, and the system account fans the same question out to
 * every server in the cluster. A page that showed one row without saying which
 * would present a three-server cluster as a single node, and an operator would
 * have no way to tell that from a cluster that really has one.
 *
 * So a listing that came from the monitoring endpoint alone carries a banner
 * saying so, with what to configure to see the rest.
 *
 * There is no disk column, and its absence is deliberate. NATS reports no disk
 * figure anywhere - not a percentage, not free space. JetStream reports what an
 * account is using against its own limit, which is a different question, and
 * putting it under a "disk" heading would answer the wrong one.
 */
export function ServersNats() {
  const { t } = useTranslation();
  const state = useNatsCluster();
  const [selected, setSelected] = useState<string | null>(null);

  const nodes = useMemo(
    () => (state.data?.nodes ?? []).filter((node): node is Node => node != null),
    [state.data],
  );
  const overview = state.data?.overview ?? null;
  const partial = nodes.length > 0 && nodes[0] != null && isFromOneServerOnly(nodes[0]);

  const panel = useMemo(
    () => nodes.find((node) => node.name === selected) ?? null,
    [nodes, selected],
  );
  const config = useNatsServerConfig(selected);

  return (
    <Page>
      <PageHeader
        title={t("board.cluster.nats.title")}
        subtitle={overview?.name ?? ""}
        actions={
          <RefreshButton
            refreshing={state.refreshing}
            online={state.online}
            onClick={() => void state.refresh()}
          />
        }
      />

      {partial && (
        /* The banner is the honest half of a single-row listing: this is what
           the connection can see, not what the cluster is. */
        <WarnBanner>{t("board.cluster.nats.oneServerOnly")}</WarnBanner>
      )}

      <Toolbar>
        <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>
          {t("board.cluster.nats.serverCount", { count: nodes.length })}
        </span>
        {overview != null && metaLeader(overview) != null && (
          <>
            <span className="flex-1" />
            <span className="mono3" style={{ fontSize: "11px", color: "var(--c-muted)" }}>
              {t("board.cluster.nats.metaLeader", { server: metaLeader(overview) })}
            </span>
          </>
        )}
      </Toolbar>

      <BoardState state={state}>
        <ListArea>
          <ListPane>
            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("board.cluster.nats.server")}</TableHead>
                  <TableHead>{t("board.cluster.nats.version")}</TableHead>
                  <TableHead style={RIGHT}>{t("board.cluster.nats.connections")}</TableHead>
                  <TableHead style={RIGHT}>{t("board.cluster.nats.subscriptions")}</TableHead>
                  <TableHead style={RIGHT}>{t("board.cluster.nats.peers")}</TableHead>
                  <TableHead style={RIGHT}>{t("board.cluster.nats.slow")}</TableHead>
                  <TableHead>{t("board.cluster.nats.jetstream")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nodes.map((node) => (
                  <TableRow
                    key={node.name}
                    selected={selected === node.name}
                    onClick={() => setSelected(node.name)}
                  >
                    <TableCell>
                      <b className="mono3" style={{ fontWeight: 500, fontSize: "11.5px" }}>
                        {node.name}
                      </b>
                      {isMetaLeader(node) && (
                        /* One server carries the stream and consumer
                           assignments; a cluster with none has JetStream
                           running and answering nothing. */
                        <Status tone="ok" style={{ fontSize: "10px", marginLeft: "6px" }}>
                          {t("board.cluster.nats.leader")}
                        </Status>
                      )}
                    </TableCell>
                    <TableCell className="mono3" style={MONO11}>
                      {node.version}
                    </TableCell>
                    <TableCell className="mono3" style={RIGHT}>
                      <Metric value={connections(node)} />
                    </TableCell>
                    <TableCell className="mono3" style={RIGHT}>
                      <Metric value={subscriptions(node)} />
                    </TableCell>
                    <TableCell className="mono3" style={RIGHT}>
                      {/* Peers rather than routes: NATS opens a pool per peer,
                          so eight routes to two peers is ordinary and only the
                          peer count answers "has the cluster formed". */}
                      <Metric value={remotes(node)} />
                    </TableCell>
                    <TableCell className="mono3" style={RIGHT}>
                      <SlowCount node={node} />
                    </TableCell>
                    <TableCell style={MONO11}>
                      {/* Per server, because a cluster can be mixed - and a
                          stream can only go where JetStream is. */}
                      <Status
                        tone={hasJetStream(node) ? "ok" : "off"}
                        style={{ fontSize: "10px" }}
                      >
                        {hasJetStream(node)
                          ? t("board.cluster.nats.jsOn")
                          : t("board.cluster.nats.jsOff")}
                      </Status>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ListPane>

          {panel != null && (
            <DetailPanel width={420} onDismiss={() => setSelected(null)}>
              <DetailPanelHeader
                title={panel.name}
                badge={
                  <Status tone="off" style={{ fontSize: "10px" }}>
                    {panel.version}
                  </Status>
                }
                onClose={() => setSelected(null)}
              />
              <DetailPanelBody>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  <Panel style={{ padding: "9px 12px" }}>
                    <div style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>
                      {t("board.cluster.nats.connections")}
                    </div>
                    <div
                      className="mono3"
                      style={{ fontSize: "15px", fontWeight: 600, marginTop: "2px" }}
                    >
                      <Metric value={connections(panel)} />
                    </div>
                  </Panel>
                  <Panel style={{ padding: "9px 12px" }}>
                    <div style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>
                      {t("board.cluster.nats.memory")}
                    </div>
                    <div
                      className="mono3"
                      style={{ fontSize: "15px", fontWeight: 600, marginTop: "2px" }}
                    >
                      <Metric value={memoryBytes(panel)} format={formatBytes} />
                    </div>
                  </Panel>
                </div>

                <KV
                  rows={[
                    [t("board.cluster.nats.address"), mono(panel.address)],
                    [t("board.cluster.nats.serverId"), mono(serverId(panel))],
                    [t("board.cluster.nats.uptime"), mono(uptime(panel))],
                    [t("board.cluster.nats.go"), mono(goVersion(panel))],
                    [
                      t("board.cluster.nats.cpu"),
                      <span className="mono3" style={MONO11}>
                        <Metric value={cpuPercent(panel)} />
                        {cores(panel) != null && ` · ${cores(panel)} cores`}
                      </span>,
                    ],
                    [
                      t("board.cluster.nats.totalConnections"),
                      <span className="mono3" style={MONO11}>
                        <Metric value={totalConnections(panel)} />
                        {maxConnections(panel) != null && (
                          <span style={{ color: "var(--c-muted)" }}>
                            {" "}
                            / {formatCount(maxConnections(panel) ?? 0)}
                          </span>
                        )}
                      </span>,
                    ],
                    [
                      t("board.cluster.nats.routes"),
                      <span className="mono3" style={MONO11}>
                        {/* Both numbers, because a pool of routes to two peers
                            is ordinary and only one of them is a health
                            figure. */}
                        <Metric value={routes(panel)} /> ·{" "}
                        {t("board.cluster.nats.toPeers", { count: remotes(panel) ?? 0 })}
                      </span>,
                    ],
                    [
                      t("board.cluster.nats.leafNodes"),
                      <span className="mono3" style={MONO11}>
                        <Metric value={leafNodes(panel)} />
                      </span>,
                    ],
                    [
                      t("board.cluster.nats.maxPayload"),
                      <span className="mono3" style={MONO11}>
                        <Metric value={maxPayload(panel)} format={formatBytes} />
                      </span>,
                    ],
                    [
                      t("board.cluster.nats.security"),
                      <span className="mono3" style={MONO11}>
                        {authRequired(panel)
                          ? t("board.cluster.nats.authOn")
                          : t("board.cluster.nats.authOff")}
                        {tlsRequired(panel) && ` · ${t("board.cluster.nats.tlsOn")}`}
                      </span>,
                    ],
                  ]}
                />

                {hasJetStream(panel) && (
                  <div>
                    <SectionLabel style={{ marginBottom: "6px" }}>
                      {t("board.cluster.nats.jetstream")}
                    </SectionLabel>
                    <KV
                      rows={[
                        [
                          t("board.cluster.nats.jsMemory"),
                          <span className="mono3" style={MONO11}>
                            <Metric value={jetStreamMemory(panel)} format={formatBytes} />
                          </span>,
                        ],
                        [
                          t("board.cluster.nats.jsStorage"),
                          <span className="mono3" style={MONO11}>
                            <Metric value={jetStreamStorage(panel)} format={formatBytes} />
                          </span>,
                        ],
                        [t("board.cluster.nats.metaLeaderRow"), mono(metaLeader(panel))],
                      ]}
                    />
                  </div>
                )}

                <div>
                  <SectionLabel style={{ marginBottom: "6px" }}>
                    {t("board.cluster.nats.settings")}
                  </SectionLabel>
                  {config.loading ? (
                    <div style={{ fontSize: "11px", color: "var(--c-muted)" }}>
                      {t("board.state.loading")}
                    </div>
                  ) : (
                    <SettingsList document={config.data ?? {}} />
                  )}
                </div>
              </DetailPanelBody>
            </DetailPanel>
          )}
        </ListArea>
      </BoardState>
    </Page>
  );
}

function mono(value: string | null) {
  return (
    <span className="mono3" style={MONO11}>
      {value ?? "—"}
    </span>
  );
}

/**
 * Clients the server disconnected for not keeping up.
 *
 * A running total since start rather than a current state, and marked only
 * when it is not zero: it is the one figure that says a consumer somewhere is
 * too slow for what is being published at it, and a zero every time would
 * train the eye past it.
 */
function SlowCount({ node }: { node: Node }) {
  const count = slowConsumers(node);
  if (count == null) return <span style={{ color: "var(--c-muted-2)" }}>—</span>;
  if (count === 0) return <>0</>;
  return (
    <Status tone="warn" style={{ fontSize: "10px" }}>
      {formatCount(count)}
    </Status>
  );
}

/**
 * The server's effective configuration, as it reports it.
 *
 * Rendered as given rather than curated: what a key means is the server's
 * business, this is a few hundred of them, and the reason to open it is
 * usually to check one specific value against what the config file says.
 */
function SettingsList({ document }: { document: Record<string, string | undefined> }) {
  const rows = useMemo(
    () =>
      Object.entries(document)
        .filter(([, value]) => value != null)
        .sort(([left], [right]) => left.localeCompare(right)),
    [document],
  );
  if (rows.length === 0) {
    return <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>—</span>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      {rows.map(([key, value]) => (
        <div key={key} className="mono3" style={{ fontSize: "10.5px", display: "flex", gap: "6px" }}>
          <span style={{ color: "var(--c-muted)", minWidth: "45%" }}>{key}</span>
          <span style={{ wordBreak: "break-all" }}>{value}</span>
        </div>
      ))}
    </div>
  );
}
