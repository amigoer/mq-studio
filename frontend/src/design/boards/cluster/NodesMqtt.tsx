import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Page, PageBody, PageHeader, RefreshButton } from "@/design/shell";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { KV, Panel, PanelHeader, SectionLabel, StatTile, Status } from "@/components";
import { BoardState } from "@/design/boards/BoardState";
import { useMqttBroker } from "@/hooks/mqtt/useMqttBroker";
import { brokerStats, formatUptimeSeconds, nodeDetail } from "@/mq/mqtt/cluster";
import { formatCount } from "@/lib/format";
import { KPI_GRID } from "@/design/boards/overview/_shared";

const MONO11 = { fontSize: "11px" } as const;

function reported(value: number | null): string {
  return value == null ? "—" : formatCount(value);
}

function reportedText(value: string): string {
  return value === "" ? "—" : value;
}

/**
 * Board 11f — MQTT nodes.
 *
 * MQTT says nothing about how a broker is deployed, so what this page can show
 * depends entirely on which tier answered. Over the protocol alone a session
 * knows about one broker, because a session is one socket - so a Mosquitto
 * shows a single row, and that is the whole truth rather than a limitation of
 * the query. A broker with a management API can name the other members, and
 * then the page is a real cluster list.
 *
 * The page says which of the two it is looking at, because "one node" and "one
 * node that we can see" are different claims.
 */
export function NodesMqtt() {
  const { t } = useTranslation();
  const state = useMqttBroker();
  const [selected, setSelected] = useState<string | null>(null);

  const overview = state.data?.overview ?? null;
  const nodes = useMemo(() => state.data?.nodes ?? [], [state.data]);
  const stats = overview != null ? brokerStats(overview) : null;

  const detail = useMemo(
    () => nodes.find((node) => node.address === selected) ?? nodes[0] ?? null,
    [nodes, selected],
  );
  const detailFields = detail != null ? nodeDetail(detail) : null;

  /*
   * A cluster the management API enumerated, or the one broker this session
   * is on. The role is only reported by an API, so its presence is what tells
   * the two apart - rather than the node count, which is 1 in both cases on a
   * single-node EMQX.
   */
  const enumerated = detailFields != null && detailFields.role !== "";

  return (
    <Page>
      <PageHeader
        title={t("shell.nav.mqtt.cluster")}
        subtitle={stats?.version ?? ""}
        actions={
          <RefreshButton
            refreshing={state.refreshing}
            online={state.online}
            onClick={() => void state.refresh()}
          />
        }
      />
      <BoardState state={state}>
        <PageBody>
          <div className={KPI_GRID}>
            <StatTile
              label={t("board.cluster.mqtt.nodes")}
              value={String(overview?.totalNodes ?? 0)}
              hint={
                enumerated
                  ? t("board.cluster.mqtt.fromApi")
                  : t("board.cluster.mqtt.fromSession")
              }
            />
            <StatTile
              label={t("board.cluster.mqtt.clients")}
              value={reported(stats?.clientsConnected ?? null)}
            />
            <StatTile
              label={t("board.cluster.mqtt.subscriptions")}
              value={reported(stats?.subscriptions ?? null)}
            />
            <StatTile
              label={t("board.cluster.mqtt.uptime")}
              value={formatUptimeSeconds(
                detailFields?.uptimeSeconds ?? stats?.uptimeSeconds ?? null,
              )}
            />
          </div>

          <div style={{ display: "flex", gap: "12px", minHeight: 0, flex: 1 }}>
            <Panel style={{ flex: 1, minWidth: 0 }}>
              <PanelHeader
                title={t("board.cluster.mqtt.title")}
                action={
                  <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>
                    {enumerated
                      ? t("board.cluster.mqtt.enumerated")
                      : t("board.cluster.mqtt.oneSocket")}
                  </span>
                }
              />
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("board.cluster.mqtt.node")}</TableHead>
                    <TableHead>{t("board.common.version")}</TableHead>
                    <TableHead>{t("board.cluster.mqtt.role")}</TableHead>
                    <TableHead>{t("board.cluster.mqtt.connections")}</TableHead>
                    <TableHead>{t("board.common.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nodes.map((node) => {
                    const fields = nodeDetail(node);
                    return (
                      <TableRow
                        key={node.address}
                        onClick={() => setSelected(node.address)}
                        aria-selected={detail?.address === node.address}
                      >
                        <TableCell className="mono3" style={MONO11}>
                          {node.name}
                        </TableCell>
                        <TableCell style={MONO11}>{reportedText(node.version)}</TableCell>
                        <TableCell style={MONO11}>{reportedText(fields.role)}</TableCell>
                        <TableCell className="mono3" style={MONO11}>
                          {reported(fields.connections)}
                        </TableCell>
                        <TableCell>
                          {node.status === "online" ? (
                            <Status tone="ok">{t("board.common.online")}</Status>
                          ) : (
                            <Status tone="err">{node.status}</Status>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Panel>

            <Panel style={{ width: "280px", flex: "none" }}>
              <PanelHeader title={t("board.cluster.mqtt.detail")} />
              {detail == null || detailFields == null ? (
                <div style={{ padding: "14px", fontSize: "12px", color: "var(--c-muted)" }}>
                  {t("board.cluster.mqtt.noNode")}
                </div>
              ) : (
                <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "10px" }}>
                  <KV
                    rows={[
                      [t("board.cluster.mqtt.node"), detail.name],
                      [t("board.common.version"), reportedText(detail.version)],
                      [t("board.cluster.mqtt.uptime"), formatUptimeSeconds(detailFields.uptimeSeconds)],
                    ]}
                  />
                  {enumerated ? (
                    <>
                      <SectionLabel>{t("board.cluster.mqtt.fromApi")}</SectionLabel>
                      <KV
                        rows={[
                          [t("board.cluster.mqtt.role"), reportedText(detailFields.role)],
                          [t("board.cluster.mqtt.edition"), reportedText(detailFields.edition)],
                          [
                            t("board.cluster.mqtt.sessions"),
                            reported(detailFields.sessions),
                          ],
                          [
                            t("board.cluster.mqtt.memory"),
                            `${reportedText(detailFields.memoryUsed)} / ${reportedText(
                              detailFields.memoryTotal,
                            )}`,
                          ],
                          [t("board.cluster.mqtt.load"), reportedText(detailFields.load1)],
                        ]}
                      />
                    </>
                  ) : (
                    // The honest version of an empty detail panel: the
                    // protocol has nothing more to say about a broker.
                    <p style={{ fontSize: "11.5px", color: "var(--c-muted)", margin: 0 }}>
                      {t("board.cluster.mqtt.sessionOnly")}
                    </p>
                  )}
                </div>
              )}
            </Panel>
          </div>
        </PageBody>
      </BoardState>
    </Page>
  );
}
