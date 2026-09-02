import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ListArea, ListPane, Page, PageHeader, RefreshButton } from "@/design/shell";
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
  MeterRow,
  MiniStat,
  Panel,
  SectionLabel,
  Status,
  WarnBanner,
} from "@/components";
import { BoardState } from "@/design/boards/BoardState";
import {
  usePulsarBrokerConfig,
  usePulsarCluster,
  usePulsarMetadataStore,
} from "@/hooks/pulsar/usePulsarCluster";
import { formatCount } from "@/lib/format";
import {
  brokerServiceURL,
  brokerVersion,
  bundleCount,
  clusterName,
  consumerCount,
  cpuPercent,
  directMemoryPercent,
  isDescribed,
  isLeader,
  memoryPercent,
  producerCount,
  topicCount,
} from "@/mq/pulsar/cluster";

const R = { textAlign: "right" } as const;

/** A figure the load manager did not report, drawn as absent, never as zero. */
function reported(value: number | null): string {
  return value == null ? "—" : formatCount(value);
}

/**
 * Board 15c — Pulsar brokers.
 *
 * Pulsar brokers are peers. There is no master and slave to colour the rows
 * by, no replica set to show trailing behind a leader, and no disk figure at
 * all - the messages are BookKeeper's and this admin API is the broker's.
 *
 * So the page is about load rather than topology, which is what an operator
 * actually opens it for on this family: who holds which bundles, and is one
 * broker carrying the cluster. The rows the load manager did not describe say
 * so rather than showing dashes with no explanation - behind a load balancer
 * it describes whichever broker answered, and the rest cannot be asked
 * through this connection.
 */
export function BrokersPulsar() {
  const { t } = useTranslation();
  const state = usePulsarCluster();
  const [selected, setSelected] = useState<string | null>(null);

  const overview = state.data?.overview ?? null;
  const nodes = state.data?.nodes ?? [];
  const node = nodes.find((candidate) => candidate.address === selected) ?? null;

  const config = usePulsarBrokerConfig(node != null ? node.address : null);
  const metadata = usePulsarMetadataStore(node != null);

  const undescribed = nodes.filter((candidate) => !isDescribed(candidate)).length;

  return (
    <Page>
      <PageHeader
        title={t("board.cluster.pulsar.title")}
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
        <ListArea>
          <ListPane>
            {undescribed > 0 && (
              <WarnBanner>
                {t("board.cluster.pulsar.undescribed", { count: undescribed })}
              </WarnBanner>
            )}
            <Panel>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("board.common.address")}</TableHead>
                    <TableHead>{t("board.common.status")}</TableHead>
                    <TableHead>{t("board.common.version")}</TableHead>
                    <TableHead style={R}>{t("board.cluster.pulsar.bundles")}</TableHead>
                    <TableHead style={R}>Topic</TableHead>
                    <TableHead style={R}>CPU</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nodes.map((row) => (
                    <TableRow
                      key={row.address}
                      data-state={row.address === selected ? "selected" : undefined}
                      onClick={() => setSelected(row.address)}
                    >
                      <TableCell className="mono3">
                        {row.address}
                        {isLeader(row) && (
                          <span className="ml-2 text-(--c-muted)">
                            {t("board.cluster.pulsar.leader")}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Status tone="ok" dot>
                          {t("board.common.online")}
                        </Status>
                      </TableCell>
                      <TableCell className="mono3">{brokerVersion(row) || "—"}</TableCell>
                      <TableCell style={R}>{reported(bundleCount(row))}</TableCell>
                      <TableCell style={R}>{reported(topicCount(row))}</TableCell>
                      <TableCell style={R}>
                        {cpuPercent(row) == null ? "—" : `${String(cpuPercent(row))}%`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Panel>
          </ListPane>

          {node != null && (
            <DetailPanel>
              <DetailPanelHeader title={node.address} onClose={() => setSelected(null)} />
              <DetailPanelBody>
                {!isDescribed(node) ? (
                  <WarnBanner>{t("board.cluster.pulsar.notDescribed")}</WarnBanner>
                ) : (
                  <>
                    <SectionLabel>{t("board.cluster.pulsar.load")}</SectionLabel>
                    <div className="flex gap-3">
                      <MiniStat
                        label={t("board.cluster.pulsar.bundles")}
                        value={reported(bundleCount(node))}
                      />
                      <MiniStat label="Topic" value={reported(topicCount(node))} />
                      <MiniStat
                        label={t("board.cluster.pulsar.producers")}
                        value={reported(producerCount(node))}
                      />
                      <MiniStat
                        label={t("board.cluster.pulsar.consumers")}
                        value={reported(consumerCount(node))}
                      />
                    </div>

                    <SectionLabel>{t("board.cluster.pulsar.resources")}</SectionLabel>
                    {/* CPU is reported scaled across every core, so the broker's
                        own limit is what turns it into a percentage. Direct
                        memory is separate from the heap and is where Pulsar
                        holds its network buffers, which is why it is worth its
                        own row rather than folded into memory. */}
                    <Meter label="CPU" percent={cpuPercent(node)} />
                    <Meter
                      label={t("board.cluster.pulsar.memory")}
                      percent={memoryPercent(node)}
                    />
                    <Meter
                      label={t("board.cluster.pulsar.directMemory")}
                      percent={directMemoryPercent(node)}
                    />
                  </>
                )}

                <SectionLabel>{t("board.cluster.pulsar.endpoints")}</SectionLabel>
                <KV
                  rows={[
                    [
                      t("board.cluster.pulsar.serviceUrl"),
                      <span className="mono3">{brokerServiceURL(node) || "—"}</span>,
                    ],
                    [
                      t("board.cluster.pulsar.metadataStore"),
                      <span className="mono3">
                        {metadata.data?.["metadataStoreUrl"] ?? "—"}
                      </span>,
                    ],
                    [
                      t("board.cluster.pulsar.ledgersRootPath"),
                      <span className="mono3">{metadata.data?.["ledgersRootPath"] ?? "—"}</span>,
                    ],
                  ]}
                />

                <SectionLabel>{t("board.cluster.pulsar.configuration")}</SectionLabel>
                {/* Pulsar has no per-broker admin endpoint: every call goes to
                    the web service address this profile names, and it answers
                    for whichever broker served it. Saying so is better than a
                    panel that implies these are this row's settings. */}
                <p className="text-xs text-muted-foreground">
                  {t("board.cluster.pulsar.configurationNote")}
                </p>
                <KV
                  rows={notableConfig(config.data).map(([key, value]) => [
                    <span className="mono3">{key}</span>,
                    <span className="mono3">{value}</span>,
                  ])}
                />
              </DetailPanelBody>
            </DetailPanel>
          )}
        </ListArea>
      </BoardState>
    </Page>
  );
}

/**
 * A resource meter whose bar and figure both say "not reported".
 *
 * MeterRow defaults its label to `${value}%`, so a missing percentage passed
 * as 0 draws an empty bar reading "0%" - which is a claim that the broker is
 * idle, not that nobody asked. Only the second is true when the load manager
 * described a different broker.
 */
function Meter({ label, percent }: { label: string; percent: number | null }) {
  return <MeterRow label={label} value={percent ?? 0} display={percent == null ? "—" : `${String(percent)}%`} />;
}

/**
 * The handful of settings worth a panel, out of the several hundred a broker
 * reports.
 *
 * A full dump belongs behind a search box, not in a detail panel; these are
 * the ones that change what the other pages can do, so an empty topics list or
 * a refused create is explained here rather than guessed at.
 */
const NOTABLE = [
  "clusterName",
  "allowAutoTopicCreation",
  "allowAutoTopicCreationType",
  "brokerDeleteInactiveTopicsEnabled",
  "defaultNumberOfNamespaceBundles",
  "loadManagerClassName",
  "authenticationEnabled",
  "authorizationEnabled",
] as const;

function notableConfig(
  config: Record<string, string | undefined> | null | undefined,
): [string, string][] {
  if (config == null) return [];
  return NOTABLE.filter((key) => config[key] != null).map((key) => [key, config[key] ?? ""]);
}
