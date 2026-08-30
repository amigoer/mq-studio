import { Star } from "lucide-react";
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
  KV,
  Panel,
  SectionLabel,
  Status,
} from "@/components";
import { Metric, NODE_CARD, NODE_GRID, NodeCard, TABLE_CARD } from "./_shared";
import { useTranslation } from "react-i18next";

const TAG = { fontSize: "10px" } as const;
const MONO11 = { fontSize: "11px" } as const;

/** Board 17a — Kafka brokers: controller star, URP and ISR shrink warnings. */
export function BrokersKafka() {
  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader
        title="Broker"
        subtitle="Kafka 3.7 · KRaft · Controller kafka-1"
        actions={<Button variant="outline">{t("board.common.refresh")}</Button>}
      />
      <PageBody style={{ gap: "12px" }}>
        <div className={NODE_GRID}>
          <NodeCard
            name="kafka-1"
            badges={
              <Status tone="ok" style={TAG}>
                Controller
                <Star size={10} fill="currentColor" aria-hidden />
              </Status>
            }
            address="rack-a · 9092"
            metrics={
              <>
                <Metric label={t("board.common.in")} value="1 820/s" />
                <Metric label={t("board.common.out")} value="3 240/s" />
                <span style={{ color: "var(--c-muted)" }}>{t("board.cluster.kafka.parts1")}</span>
              </>
            }
            meters={[{ label: t("board.cluster.kafka.disk58"), value: 58 }]}
          />
          <NodeCard
            name="kafka-2"
            badges={<Status tone="ok" style={TAG}>Broker</Status>}
            address="rack-b · 9092"
            metrics={
              <>
                <Metric label={t("board.common.in")} value="1 704/s" />
                <Metric label={t("board.common.out")} value="2 988/s" />
                <span style={{ color: "var(--c-muted)" }}>{t("board.cluster.kafka.parts2")}</span>
              </>
            }
            meters={[{ label: t("board.cluster.kafka.disk61"), value: 61 }]}
          />
          <NodeCard
            name="kafka-3"
            badges={
              <>
                <Status tone="ok" style={TAG}>Broker</Status>
                <Status tone="warn" style={TAG}>{t("board.cluster.kafka.isrShrink")}</Status>
              </>
            }
            address="rack-c · 9092"
            metrics={
              <>
                <Metric label={t("board.common.in")} value="1 688/s" />
                <Metric label={t("board.common.out")} value="2 901/s" />
                <span style={{ color: "var(--c-warn-text)" }}>URP 2</span>
              </>
            }
            meters={[{ label: t("board.cluster.kafka.disk74"), value: 74, color: "var(--c-warn)" }]}
          />
          <Panel style={NODE_CARD}>
            <SectionLabel>{t("board.cluster.kafka.configSummary")}</SectionLabel>
            <KV
              rows={[
                ["min.insync.replicas", <span className="mono3" style={MONO11}>2</span>],
                ["default.replication", <span className="mono3" style={MONO11}>3</span>],
                ["auto.create.topics", <span className="mono3" style={MONO11}>false</span>],
              ]}
            />
          </Panel>
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
            <b style={{ fontSize: "12.5px" }}>{t("board.cluster.kafka.urp")}</b>
            <span className="flex-1" />
            <span style={{ fontSize: "11.5px", color: "var(--c-fg-2)" }}>{t("board.cluster.kafka.reelect")}</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Topic</TableHead>
                <TableHead style={{ textAlign: "right" }}>{t("board.common.partition")}</TableHead>
                <TableHead>ISR</TableHead>
                <TableHead>{t("board.cluster.kafka.missingReplicas")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="mono3" style={MONO11}>orders.created</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>2</TableCell>
                <TableCell className="mono3" style={MONO11}>3,1</TableCell>
                <TableCell className="mono3" style={{ ...MONO11, color: "var(--c-warn-text)" }}>
                  {t("board.cluster.kafka.lagRow1")}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="mono3" style={MONO11}>payments.captured</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>7</TableCell>
                <TableCell className="mono3" style={MONO11}>1,2</TableCell>
                <TableCell className="mono3" style={{ ...MONO11, color: "var(--c-warn-text)" }}>{t("board.cluster.kafka.lagRow2")}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Panel>
      </PageBody>
    </Page>
  );
}
