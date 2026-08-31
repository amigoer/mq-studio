import { useState } from "react";
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
  MiniStat,
  Panel,
  Segmented,
  SectionLabel,
  Status,
} from "@/components";
import { BoardState } from "@/design/boards/BoardState";
import type { BrokerData } from "@/hooks/useBrokerData";
import type { TransactionView } from "@bindings/bridge/models";
import {
  useKafkaBrokerConfig,
  useKafkaCluster,
  useKafkaLogDirs,
  useKafkaTransactions,
} from "@/hooks/kafka/useKafkaCluster";
import { formatBytes, formatCount } from "@/lib/format";
import {
  clusterID,
  controllerNode,
  isController,
  nodeID,
  rack,
  transactionAge,
  transactionOverdue,
} from "@/mq/kafka/cluster";

const R = { textAlign: "right" } as const;
const MONO11 = { fontSize: "11px" } as const;

type View = "brokers" | "storage" | "transactions";

/**
 * Board 17a — Kafka brokers.
 *
 * The canvas drew a disk-usage percentage. Kafka reports no such number: the
 * whole protocol carries occupied bytes per log directory and nothing about
 * the filesystem holding it - no capacity, no free space, no percentage. So
 * the storage view shows sizes and says where they came from, rather than a
 * meter filled in from a denominator nobody supplied.
 *
 * There is no per-broker throughput either, for the same reason every other
 * Kafka board has none: rates are JMX metrics.
 */
export function BrokersKafka() {
  const { t } = useTranslation();
  const [view, setView] = useState<View>("brokers");
  const [selected, setSelected] = useState<string | null>(null);

  const state = useKafkaCluster();
  const storage = useKafkaLogDirs(view === "storage");
  const transactions = useKafkaTransactions(view === "transactions");
  const config = useKafkaBrokerConfig(selected);

  const overview = state.data?.overview ?? null;
  const nodes = state.data?.nodes ?? [];
  const dirs = storage.data?.dirs ?? [];
  const largest = storage.data?.largest ?? [];
  // Read once per render so every row in the panel is aged against the same
  // instant, rather than each cell against a slightly later one.
  const now = Date.now();

  return (
    <Page>
      <PageHeader
        title={t("board.cluster.kafka.title")}
        subtitle={overview != null ? clusterID(overview) : ""}
        actions={
          <RefreshButton
            refreshing={state.refreshing || storage.refreshing || transactions.refreshing}
            online={state.online}
            onClick={() => {
              void state.refresh();
              if (view === "storage") void storage.refresh();
              if (view === "transactions") void transactions.refresh();
            }}
          />
        }
      />
      <Toolbar>
        <Segmented<View>
          options={[
            { value: "brokers", label: t("board.cluster.kafka.brokers") },
            { value: "storage", label: t("board.cluster.kafka.storage") },
            { value: "transactions", label: t("board.cluster.kafka.transactions") },
          ]}
          value={view}
          onChange={setView}
        />
        <span className="flex-1" />
        {overview != null && controllerNode(overview) !== "" && (
          <span style={{ fontSize: "11.5px", color: "var(--c-muted)" }}>
            {t("board.overview.kafka.controllerIs", { id: controllerNode(overview) })}
          </span>
        )}
      </Toolbar>

      {view === "brokers" ? (
        <BoardState state={state}>
          <ListArea>
            <ListPane>
              <Table inset>
                <TableHeader>
                  <TableRow>
                    <TableHead style={R}>ID</TableHead>
                    <TableHead>{t("board.common.address")}</TableHead>
                    <TableHead>Rack</TableHead>
                    <TableHead>{t("board.common.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nodes.map((node) => (
                    <TableRow
                      key={node.id}
                      selected={selected === node.address}
                      onClick={() => setSelected(node.address)}
                    >
                      <TableCell className="mono3" style={R}>{nodeID(node)}</TableCell>
                      <TableCell className="mono3" style={MONO11}>{node.address}</TableCell>
                      <TableCell className="mono3" style={MONO11}>
                        {rack(node) === "" ? "—" : rack(node)}
                      </TableCell>
                      <TableCell>
                        {isController(node) ? (
                          <Status tone="ok">{t("board.overview.kafka.controller")}</Status>
                        ) : (
                          <Status tone="off">{t("board.overview.kafka.broker")}</Status>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ListPane>

            {selected != null && (
              <DetailPanel width={440} onDismiss={() => setSelected(null)}>
                <DetailPanelHeader
                  title={selected}
                  tabs={[{ id: "config", label: t("board.cluster.kafka.effectiveConfig") }]}
                  activeTab="config"
                  onTabChange={() => {}}
                  onClose={() => setSelected(null)}
                />
                <DetailPanelBody>
                  <BoardState state={config}>
                    <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>
                      {t("board.cluster.kafka.effectiveNote")}
                    </span>
                    <KV
                      rows={Object.keys(config.data ?? {})
                        .sort()
                        .map((key) => [key, (config.data ?? {})[key] ?? ""] as const)}
                    />
                  </BoardState>
                </DetailPanelBody>
              </DetailPanel>
            )}
          </ListArea>
        </BoardState>
      ) : view === "storage" ? (
        <BoardState state={storage}>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "12px 14px", overflow: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
              <MiniStat
                label={t("board.cluster.kafka.totalSize")}
                value={formatBytes(storage.data?.total ?? 0)}
                size={15}
              />
              <MiniStat
                label={t("board.cluster.kafka.dirs")}
                value={formatCount(dirs.length)}
                size={15}
              />
              <MiniStat
                label={t("board.cluster.kafka.unreadableDirs")}
                value={formatCount(storage.data?.failed ?? 0)}
                color={(storage.data?.failed ?? 0) > 0 ? "var(--c-err-text)" : undefined}
                size={15}
              />
            </div>
            <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>
              {t("board.cluster.kafka.storageNote")}
            </span>

            <div>
              <SectionLabel style={{ marginBottom: "6px" }}>
                {t("board.cluster.kafka.dirsTitle")}
              </SectionLabel>
              <Panel style={{ overflow: "hidden" }}>
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow>
                      <TableHead style={R}>Broker</TableHead>
                      <TableHead>{t("board.cluster.kafka.path")}</TableHead>
                      <TableHead style={R}>{t("board.common.partition")}</TableHead>
                      <TableHead style={R}>{t("board.cluster.kafka.size")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dirs.map((dir) => (
                      <TableRow key={`${dir?.broker}/${dir?.path}`}>
                        <TableCell className="mono3" style={R}>{dir?.broker}</TableCell>
                        <TableCell className="mono3" style={MONO11}>
                          {dir?.path}
                          {dir?.err !== "" && (
                            <span style={{ color: "var(--c-err-text)" }}> · {dir?.err}</span>
                          )}
                        </TableCell>
                        <TableCell className="mono3" style={R}>{dir?.partitions}</TableCell>
                        <TableCell className="mono3" style={R}>
                          {dir?.err === "" ? formatBytes(dir?.size ?? 0) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Panel>
            </div>

            <div>
              <SectionLabel style={{ marginBottom: "6px" }}>
                {t("board.cluster.kafka.largest")}
              </SectionLabel>
              <Panel style={{ overflow: "hidden" }}>
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Topic</TableHead>
                      <TableHead style={R}>P</TableHead>
                      <TableHead style={R}>Broker</TableHead>
                      <TableHead style={R}>{t("board.cluster.kafka.size")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {largest.map((partition) => (
                      <TableRow key={`${partition?.broker}/${partition?.topic}/${partition?.partition}`}>
                        <TableCell className="mono3" style={MONO11}>
                          {partition?.topic}
                          {partition?.isFuture === true && (
                            <Status tone="warn" style={{ fontSize: "10px", marginLeft: "4px" }}>
                              {t("board.cluster.kafka.moving")}
                            </Status>
                          )}
                        </TableCell>
                        <TableCell className="mono3" style={R}>{partition?.partition}</TableCell>
                        <TableCell className="mono3" style={R}>{partition?.broker}</TableCell>
                        <TableCell className="mono3" style={R}>
                          {formatBytes(partition?.size ?? 0)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Panel>
            </div>
          </div>
        </BoardState>
      ) : (
        <KafkaTransactionsPanel state={transactions} now={now} />
      )}
    </Page>
  );
}

/**
 * The transactions tab.
 *
 * Its own component rather than a branch inside the board because it is the
 * one view here that cannot be reached without a click, and a panel that only
 * a click can render is a panel nothing can test.
 */
export function KafkaTransactionsPanel({
  state,
  now,
}: {
  state: BrokerData<TransactionView>;
  now: number;
}) {
  const { t } = useTranslation();
  const open = (state.data?.transactions ?? []).filter((txn) => txn != null);
  const overdue = open.filter((txn) =>
    transactionOverdue(txn.startedAt, txn.timeoutMs, now),
  ).length;

  return (
    <BoardState state={state}>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "12px 14px", overflow: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
          <MiniStat
            label={t("board.cluster.kafka.txnOpen")}
            value={formatCount(open.length)}
            size={15}
          />
          <MiniStat
            label={t("board.cluster.kafka.txnHolding")}
            value={formatCount(state.data?.holding ?? 0)}
            color={(state.data?.holding ?? 0) > 0 ? "var(--c-warn-text)" : undefined}
            size={15}
          />
          <MiniStat
            label={t("board.cluster.kafka.txnOverdue")}
            value={formatCount(overdue)}
            color={overdue > 0 ? "var(--c-err-text)" : undefined}
            size={15}
          />
        </div>
        <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>
          {t("board.cluster.kafka.txnNote")}
        </span>

        <Panel style={{ overflow: "hidden" }}>
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>{t("board.cluster.kafka.txnId")}</TableHead>
                <TableHead>{t("board.common.status")}</TableHead>
                <TableHead style={R}>{t("board.cluster.kafka.txnCoordinator")}</TableHead>
                <TableHead style={R}>{t("board.cluster.kafka.txnProducer")}</TableHead>
                <TableHead style={R}>{t("board.cluster.kafka.txnAge")}</TableHead>
                <TableHead>{t("board.cluster.kafka.txnHolds")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {open.map((txn) => (
                <TableRow key={`${txn.id}/${txn.producerId}`}>
                  <TableCell className="mono3" style={MONO11}>{txn.id}</TableCell>
                  <TableCell>
                    <Status tone={txn.holding ? "warn" : "off"}>{txn.state}</Status>
                    {transactionOverdue(txn.startedAt, txn.timeoutMs, now) && (
                      <Status tone="err" style={{ fontSize: "10px", marginLeft: "4px" }}>
                        {t("board.cluster.kafka.txnPastTimeout")}
                      </Status>
                    )}
                  </TableCell>
                  <TableCell className="mono3" style={R}>{txn.coordinator}</TableCell>
                  <TableCell className="mono3" style={R}>
                    {txn.producerId}
                    <span style={{ color: "var(--c-muted)" }}>/{txn.producerEpoch}</span>
                  </TableCell>
                  <TableCell className="mono3" style={R}>
                    {transactionAge(txn.startedAt, now)}
                  </TableCell>
                  <TableCell className="mono3" style={MONO11}>
                    {(txn.partitions ?? []).length === 0
                      ? "—"
                      : (txn.partitions ?? []).join("  ")}
                  </TableCell>
                </TableRow>
              ))}
              {open.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} style={{ padding: "18px", color: "var(--c-muted)" }}>
                    {t("board.cluster.kafka.txnEmpty")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Panel>
      </div>
    </BoardState>
  );
}
