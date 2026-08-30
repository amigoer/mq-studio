import { Page, PageBody, PageHeader } from "@/design/shell";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Panel,
  Status,
} from "@/components";
import { Metric, NODE_GRID, NodeCard, TABLE_CARD } from "./_shared";
import { useTranslation } from "react-i18next";

const TAG = { fontSize: "10px" } as const;
const MONO11 = { fontSize: "11px" } as const;

/** Board 17c — Pulsar's two tiers: broker load above, bookie storage below. */
export function BrokersPulsar() {
  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader
        title="Broker / Bookie"
        subtitle="Pulsar 3.2 · Broker 3 · Bookie 4"
        actions={<Button variant="outline">{t("board.common.refresh")}</Button>}
      />
      <PageBody style={{ gap: "12px" }}>
        <div className={NODE_GRID}>
          <NodeCard
            name="broker-1"
            badges={<Status tone="ok" style={TAG}>Broker</Status>}
            address="6650"
            metrics={
              <>
                <Metric label="Topic" value="82" />
                <Metric label={t("board.common.in")} value="720/s" />
                <Metric label={t("board.common.out")} value="804/s" />
              </>
            }
            meters={[{ label: t("board.cluster.pulsar.load44"), value: 44 }]}
          />
          <NodeCard
            name="broker-2"
            badges={<Status tone="ok" style={TAG}>Broker</Status>}
            address="6650"
            metrics={
              <>
                <Metric label="Topic" value="76" />
                <Metric label={t("board.common.in")} value="648/s" />
                <Metric label={t("board.common.out")} value="701/s" />
              </>
            }
            meters={[{ label: t("board.cluster.pulsar.load41"), value: 41 }]}
          />
          <NodeCard
            name="bookie-1 / 2"
            badges={<Status tone="ok" style={TAG}>Bookie</Status>}
            address="3181"
            metrics={
              <>
                <Metric label={t("board.cluster.pulsar.writeLatency")} value="1.8ms" />
                <Metric label={t("board.cluster.pulsar.readLatency")} value="0.9ms" />
              </>
            }
            meters={[
              { label: t("board.cluster.pulsar.store58"), value: 58 },
              { label: t("board.cluster.pulsar.store61"), value: 61 },
            ]}
          />
          <NodeCard
            name="bookie-3 / 4"
            badges={
              <>
                <Status tone="ok" style={TAG}>Bookie</Status>
                <Status tone="warn" style={TAG}>bookie-4 73%</Status>
              </>
            }
            address="3181"
            metrics={
              <>
                <Metric label={t("board.cluster.pulsar.writeLatency")} value="2.1ms" />
                <Metric label={t("board.cluster.pulsar.readLatency")} value="1.0ms" />
              </>
            }
            meters={[
              { label: t("board.cluster.pulsar.store57"), value: 57 },
              { label: t("board.cluster.pulsar.store73"), value: 73, color: "var(--c-warn)" },
            ]}
          />
        </div>

        <Panel style={TABLE_CARD}>
          <div
            style={{
              padding: "11px 16px",
              borderBottom: "1px solid var(--c-border)",
              display: "flex",
              alignItems: "center",
            }}
          >
            <b style={{ fontSize: "12.5px" }}>{t("board.cluster.pulsar.bundles")}</b>
            <span className="flex-1" />
            <span style={{ fontSize: "11.5px", color: "var(--c-fg-2)" }}>{t("board.cluster.pulsar.rebalance")}</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("board.common.namespace")}</TableHead>
                <TableHead style={{ textAlign: "right" }}>bundle</TableHead>
                <TableHead>{t("board.cluster.pulsar.distribution")}</TableHead>
                <TableHead style={{ textAlign: "right" }}>{t("board.common.throughputShort")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="mono3" style={MONO11}>ecommerce/orders</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>16</TableCell>
                <TableCell className="mono3" style={MONO11}>b1×6 · b2×5 · b3×5</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>1.8k/s</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="mono3" style={MONO11}>ecommerce/payments</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>8</TableCell>
                <TableCell className="mono3" style={MONO11}>b1×3 · b2×3 · b3×2</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>880/s</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Panel>
      </PageBody>
    </Page>
  );
}
