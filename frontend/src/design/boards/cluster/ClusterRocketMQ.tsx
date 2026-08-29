import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { Page, PageBody, PageHeader } from "@/design/shell";
import { Btn, Card, Status, Table, TBody, TD, TH, THead, TR } from "@/design/ui";
import { useCluster } from "@/hooks/useCluster";
import { BoardState, Notice, isBlocked } from "@/design/boards/BoardState";
import {
  BrokerRole,
  brokerId,
  brokerName,
  commitLogDiskUsage,
  consumeQueueDiskUsage,
  groupCount,
  msgInToday,
  msgOutToday,
  role,
  topicCount,
} from "@/mq/rocketmq/nodes";
import type { Node } from "@/api/models";
import { Metric, NODE_GRID, NodeCard, TABLE_CARD } from "./_shared";

const TAG = { fontSize: "10px" } as const;
const MONO11 = { fontSize: "11px" } as const;

/** RocketMQ reports -1 where a broker did not answer; nothing invents a zero. */
const UNKNOWN = -1;

function metric(value: number): string {
  return value === UNKNOWN ? "—" : value.toLocaleString();
}

function rate(value: number): string {
  return value === UNKNOWN ? "—" : `${value.toLocaleString()}/s`;
}

/** The canvas amber: a broker past its watermark colours its own meter. */
function diskColor(percent: number): { color?: string; labelColor?: string } {
  if (percent >= 85) return { color: "var(--c-warn)", labelColor: "var(--c-warn-text)" };
  return {};
}

/**
 * Board 3f — RocketMQ brokers.
 *
 * The canvas also drew a NameServer table with round-trip, flush mode and
 * CommitLog latency columns. The admin protocol reports none of those - the
 * NameServer list is just the addresses the profile was dialled with - so the
 * table is a broker runtime table instead, carrying the figures the brokers do
 * report. PageCache latency, uptime and slave sync lag are gone for the same
 * reason.
 */
export function ClusterRocketMQ() {
  const { t } = useTranslation();
  const state = useCluster();
  const nodes = state.data?.nodes ?? [];

  const masters = nodes.filter((node) => role(node) === BrokerRole.Master);
  const slaves = nodes.filter((node) => role(node) === BrokerRole.Slave);
  const version = nodes.find((node) => node.version !== "")?.version ?? "";
  const overview = state.data?.cluster?.overview;

  return (
    <Page>
      <PageHeader
        title={t("board.cluster.rocketmq.liveTitle", {
          cluster: overview?.name || t("board.cluster.rocketmq.title"),
        })}
        subtitle={t(
          version === ""
            ? "board.cluster.rocketmq.liveSubtitleNoVersion"
            : "board.cluster.rocketmq.liveSubtitle",
          { version, masters: masters.length, slaves: slaves.length },
        )}
        actions={
          <Btn disabled={state.refreshing || !state.online} onClick={() => void state.refresh()}>
            {state.refreshing && <RefreshCw size={12} className="mqs-turning" aria-hidden />}
            {t("board.common.refresh")}
          </Btn>
        }
      />
      {isBlocked(state) ? (
        <BoardState state={state} />
      ) : nodes.length === 0 ? (
        <Notice title={t("board.cluster.rocketmq.noBrokers")} />
      ) : (
        <PageBody style={{ gap: "12px" }}>
          <div className={NODE_GRID}>
            {nodes.map((node) => (
              <BrokerTile key={`${brokerName(node)}-${brokerId(node)}`} node={node} />
            ))}
          </div>
          <Card style={TABLE_CARD}>
            <div
              style={{
                padding: "11px 16px",
                borderBottom: "1px solid var(--c-border)",
                display: "flex",
                alignItems: "center",
              }}
            >
              <b style={{ fontSize: "12.5px" }}>{t("board.cluster.rocketmq.runtime")}</b>
            </div>
            <Table>
              <THead>
                <TR>
                  <TH>{t("board.common.address")}</TH>
                  <TH>{t("board.common.role")}</TH>
                  <TH style={{ textAlign: "right" }}>{t("board.cluster.rocketmq.topics")}</TH>
                  <TH style={{ textAlign: "right" }}>{t("board.cluster.rocketmq.groups")}</TH>
                  <TH style={{ textAlign: "right" }}>{t("board.cluster.rocketmq.todayIn")}</TH>
                  <TH style={{ textAlign: "right" }}>{t("board.cluster.rocketmq.todayOut")}</TH>
                  <TH style={{ textAlign: "right" }}>{t("board.cluster.rocketmq.consumeQueue")}</TH>
                </TR>
              </THead>
              <TBody>
                {nodes.map((node) => (
                  <TR key={`row-${brokerName(node)}-${brokerId(node)}`}>
                    <TD className="mono3" style={MONO11}>
                      {node.address}
                    </TD>
                    <TD>{role(node)}</TD>
                    <TD className="mono3" style={{ textAlign: "right" }}>
                      {metric(topicCount(node))}
                    </TD>
                    <TD className="mono3" style={{ textAlign: "right" }}>
                      {metric(groupCount(node))}
                    </TD>
                    <TD className="mono3" style={{ textAlign: "right" }}>
                      {metric(msgInToday(node))}
                    </TD>
                    <TD className="mono3" style={{ textAlign: "right" }}>
                      {metric(msgOutToday(node))}
                    </TD>
                    <TD className="mono3" style={{ textAlign: "right" }}>
                      {consumeQueueDiskUsage(node) === UNKNOWN
                        ? "—"
                        : `${consumeQueueDiskUsage(node)}%`}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        </PageBody>
      )}
    </Page>
  );
}

function BrokerTile({ node }: { node: Node }) {
  const { t } = useTranslation();
  const isSlave = role(node) === BrokerRole.Slave;
  const disk = commitLogDiskUsage(node);
  const label = `${brokerName(node)}${brokerId(node) !== 0 ? `-${brokerId(node)}` : ""}`;

  return (
    <NodeCard
      dim={isSlave}
      name={label}
      badges={
        <>
          <Status tone={node.status === "online" ? "ok" : "off"} style={TAG}>
            {role(node)}
          </Status>
          {disk !== UNKNOWN && disk >= 85 && (
            <Status tone="warn" style={TAG}>
              {t("board.cluster.rocketmq.diskAlert")}
            </Status>
          )}
        </>
      }
      address={node.address}
      metrics={
        <>
          <Metric label={t("board.common.in")} value={rate(node.rateIn)} />
          <Metric label={t("board.common.out")} value={rate(node.rateOut)} />
        </>
      }
      meters={
        disk === UNKNOWN
          ? []
          : [
              {
                label: t("board.cluster.rocketmq.disk", { percent: disk }),
                value: disk,
                ...(isSlave ? { color: "var(--c-muted-2)" } : diskColor(disk)),
              },
            ]
      }
    />
  );
}
