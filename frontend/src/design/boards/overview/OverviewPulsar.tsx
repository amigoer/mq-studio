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
import { KV, Panel, PanelHeader, StatTile, Status } from "@/components";
import { BoardState } from "@/design/boards/BoardState";
import { usePulsarCluster } from "@/hooks/pulsar/usePulsarCluster";
import { formatCount } from "@/lib/format";
import {
  brokerVersion,
  bundleCount,
  clusterBrokerServiceURL,
  clusterName,
  clusterServiceURL,
  consumerCount,
  isDescribed,
  isLeader,
  metadataStore,
  producerCount,
  topicCount,
} from "@/mq/pulsar/cluster";
import { KPI_GRID, TABLE_CARD } from "./_shared";

/** A count the cluster did not report, drawn as absent rather than as zero. */
function reported(value: number | null): string {
  return value == null ? "—" : formatCount(value);
}

/**
 * Board 11c — Pulsar overview.
 *
 * The canvas drew a broker/bookie pair, a namespace count, a topic count and a
 * cluster-wide pending total. Two of them survive; two do not, and what
 * replaced them is the honest part of this page.
 *
 * There is no bookie figure, because the admin API this driver speaks is the
 * broker's: BookKeeper has its own and Pulsar does not proxy it. There is no
 * cluster topic total either - counting topics means walking every namespace,
 * which is the topics page's job and costs a request each - so the header says
 * it does not know rather than showing a zero that reads as an empty cluster.
 *
 * What is here instead is what the load manager actually reports, and it is a
 * better page for it: bundles. A namespace is split into them, each is owned
 * by exactly one broker, and an uneven spread is what an unbalanced cluster
 * looks like long before it shows up in the traffic.
 */
export function OverviewPulsar() {
  const { t } = useTranslation();
  const state = usePulsarCluster();

  const overview = state.data?.overview ?? null;
  const nodes = state.data?.nodes ?? [];
  const described = nodes.filter(isDescribed);
  const leader = nodes.find(isLeader) ?? null;

  return (
    <Page>
      <PageHeader
        title={t("board.common.overview")}
        subtitle={overview != null ? clusterName(overview) : ""}
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
              label="Broker"
              value={reported(nodes.length === 0 ? null : nodes.length)}
              hint={
                leader != null
                  ? t("board.overview.pulsar.leaderIs", { address: leader.address })
                  : t("board.overview.pulsar.noLeader")
              }
            />
            <StatTile
              label={t("board.overview.pulsar.bundles")}
              value={reported(sum(described.map(bundleCount)))}
              hint={t("board.overview.pulsar.bundlesHint")}
            />
            <StatTile
              label="Topic"
              value={reported(sum(described.map(topicCount)))}
              hint={t("board.overview.pulsar.topicsHint")}
            />
            <StatTile
              label={t("board.overview.pulsar.producers")}
              value={reported(sum(described.map(producerCount)))}
              hint={t("board.overview.pulsar.clientsHint")}
            />
            <StatTile
              label={t("board.overview.pulsar.consumers")}
              value={reported(sum(described.map(consumerCount)))}
              hint={t("board.overview.pulsar.clientsHint")}
            />
          </div>

          {overview != null && (
            <Panel style={{ padding: "13px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <PanelHeader title={t("board.overview.pulsar.endpoints")} />
              <KV
                rows={[
                  [
                    t("board.overview.pulsar.brokerServiceUrl"),
                    <span className="mono3">{clusterBrokerServiceURL(overview) || "—"}</span>,
                  ],
                  [
                    t("board.overview.pulsar.webServiceUrl"),
                    <span className="mono3">{clusterServiceURL(overview) || "—"}</span>,
                  ],
                  [
                    t("board.overview.pulsar.metadataStore"),
                    <span className="mono3">{metadataStore(overview) || "—"}</span>,
                  ],
                ]}
              />
            </Panel>
          )}

          <Panel style={TABLE_CARD}>
            <PanelHeader title={t("board.overview.pulsar.brokers")} />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("board.common.address")}</TableHead>
                  <TableHead>{t("board.common.status")}</TableHead>
                  <TableHead>{t("board.common.version")}</TableHead>
                  <TableHead className="text-right">{t("board.overview.pulsar.bundles")}</TableHead>
                  <TableHead className="text-right">Topic</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nodes.map((node) => (
                  <TableRow key={node.address}>
                    <TableCell className="mono3">
                      {node.address}
                      {isLeader(node) && (
                        <span className="ml-2 text-(--c-muted)">
                          {t("board.overview.pulsar.leader")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Status tone="ok">{t("board.common.online")}</Status>
                    </TableCell>
                    <TableCell className="mono3">{brokerVersion(node) || "—"}</TableCell>
                    <TableCell className="text-right">{reported(bundleCount(node))}</TableCell>
                    <TableCell className="text-right">{reported(topicCount(node))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Panel>
        </PageBody>
      </BoardState>
    </Page>
  );
}

/**
 * A total over the brokers that reported, or null when none did.
 *
 * Summing only the described brokers is deliberate and is why the tiles carry
 * the "reported by" hint: behind a load balancer the load manager describes
 * one broker, so this is a total over part of the cluster. Showing it as the
 * whole would be wrong; showing nothing would throw away the only figures
 * there are.
 */
function sum(values: (number | null)[]): number | null {
  const known = values.filter((value): value is number => value != null);
  return known.length === 0 ? null : known.reduce((total, value) => total + value, 0);
}
