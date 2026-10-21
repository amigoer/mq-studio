import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ListArea, ListPane, Page, PageHeader, RefreshButton, StatusBar } from "@/design/shell";
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
  StatTile,
  Status,
} from "@/components";
import { BoardState, isBlocked } from "@/design/boards/BoardState";
import { useMqttBroker } from "@/hooks/mqtt/useMqttBroker";
import { brokerStats, formatUptimeSeconds, nodeDetail } from "@/mq/mqtt/cluster";
import { formatCount } from "@/lib/format";
import { KPI_GRID } from "@/design/boards/overview/_shared";
import type { Node } from "@bindings/model/models";

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

  const current = nodes.find((node) => node.address === selected) ?? null;
  // The open node, else the first: what the uptime tile and the source label read.
  const lead = current ?? nodes[0] ?? null;
  const leadFields = lead != null ? nodeDetail(lead) : null;

  /*
   * A cluster the management API enumerated, or the one broker this session
   * is on. The role is only reported by an API, so its presence is what tells
   * the two apart - rather than the node count, which is 1 in both cases on a
   * single-node EMQX.
   */
  const enumerated = leadFields != null && leadFields.role !== "";

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
      {isBlocked(state) ? (
        <BoardState state={state} />
      ) : (
        <>
          <div className="flex-none px-5 py-4">
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
                  leadFields?.uptimeSeconds ?? stats?.uptimeSeconds ?? null,
                )}
              />
            </div>
          </div>

          <ListArea>
            <ListPane>
              <Table inset>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("board.cluster.mqtt.node")}</TableHead>
                    <TableHead>{t("board.common.version")}</TableHead>
                    <TableHead>{t("board.cluster.mqtt.role")}</TableHead>
                    <TableHead className="num">{t("board.cluster.mqtt.connections")}</TableHead>
                    <TableHead>{t("board.common.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nodes.map((node) => {
                    const fields = nodeDetail(node);
                    return (
                      <TableRow
                        key={node.address}
                        selected={selected === node.address}
                        onClick={() => setSelected(node.address)}
                      >
                        <TableCell className="mono3 text-xs">{node.name}</TableCell>
                        <TableCell>{reportedText(node.version)}</TableCell>
                        <TableCell>{reportedText(fields.role)}</TableCell>
                        <TableCell className="num">{reported(fields.connections)}</TableCell>
                        <TableCell>
                          <NodeStatus node={node} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {nodes.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                        {t("board.cluster.mqtt.none")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </ListPane>

            {current != null && (
              <NodeSheet
                key={current.address}
                node={current}
                enumerated={enumerated}
                onClose={() => setSelected(null)}
              />
            )}
          </ListArea>
        </>
      )}
      {!isBlocked(state) && (
        <StatusBar
          left={
            <span>
              {enumerated
                ? t("board.cluster.mqtt.enumerated")
                : t("board.cluster.mqtt.oneSocket")}
            </span>
          }
        />
      )}
    </Page>
  );
}

function NodeStatus({ node }: { node: Node }) {
  const { t } = useTranslation();
  return node.status === "online" ? (
    <Status tone="ok">{t("board.common.online")}</Status>
  ) : (
    <Status tone="err">{node.status}</Status>
  );
}

export function NodeSheet({
  node,
  enumerated,
  onClose,
}: {
  node: Node;
  enumerated: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const fields = nodeDetail(node);
  return (
    <DetailPanel width={380} onDismiss={onClose}>
      <DetailPanelHeader title={node.name} badge={<NodeStatus node={node} />} onClose={onClose} />
      <DetailPanelBody>
        <div className="grid grid-cols-2 gap-2">
          <MiniStat
            label={t("board.cluster.mqtt.uptime")}
            value={formatUptimeSeconds(fields.uptimeSeconds)}
          />
          {enumerated && (
            <MiniStat
              label={t("board.cluster.mqtt.sessions")}
              value={reported(fields.sessions)}
            />
          )}
        </div>

        <KV rows={[[t("board.common.version"), reportedText(node.version)]]} />

        {enumerated ? (
          <div>
            <SectionLabel className="mb-1.5">{t("board.cluster.mqtt.fromApi")}</SectionLabel>
            <KV
              rows={[
                [t("board.cluster.mqtt.role"), reportedText(fields.role)],
                [t("board.cluster.mqtt.edition"), reportedText(fields.edition)],
                [
                  t("board.cluster.mqtt.memory"),
                  `${reportedText(fields.memoryUsed)} / ${reportedText(fields.memoryTotal)}`,
                ],
                [t("board.cluster.mqtt.load"), reportedText(fields.load1)],
              ]}
            />
          </div>
        ) : (
          // The honest version of an empty detail panel: the
          // protocol has nothing more to say about a broker.
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("board.cluster.mqtt.sessionOnly")}
          </p>
        )}
      </DetailPanelBody>
    </DetailPanel>
  );
}
