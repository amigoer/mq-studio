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

/** Board 17d — Redis is a single instance: INFO, persistence, slow log. */
export function NodeRedis() {
  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader title={t("board.common.node")} subtitle={t("board.cluster.redis.subtitle")} actions={<Button variant="outline">{t("board.common.refresh")}</Button>} />
      <PageBody style={{ gap: "12px" }}>
        <div className={NODE_GRID}>
          <NodeCard
            name="10.2.0.8:6379"
            badges={<Status tone="ok" style={TAG}>master</Status>}
            address="uptime 96d"
            metrics={
              <>
                <Metric label="ops" value="3 420/s" />
                <Metric label={t("board.common.connections")} value="86" />
                <Metric label={t("board.cluster.redis.hitRate")} value="99.2%" />
              </>
            }
            meters={[{ label: t("board.cluster.redis.memory"), value: 20 }]}
          />
          <Panel style={NODE_CARD}>
            <SectionLabel>{t("board.common.persistence")}</SectionLabel>
            <KV
              rows={[
                ["AOF", <span className="mono3" style={MONO11}>{t("board.cluster.redis.aof")}</span>],
                ["RDB", <span className="mono3" style={MONO11}>{t("board.cluster.redis.rdb")}</span>],
                [t("board.common.copy"), <span className="mono3" style={MONO11}>{t("board.cluster.redis.noReplica")}</span>],
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
            <b style={{ fontSize: "12.5px" }}>{t("board.cluster.redis.slowlog")}</b>
            <span className="flex-1" />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("board.cluster.redis.command")}</TableHead>
                <TableHead style={{ textAlign: "right" }}>{t("board.cluster.redis.elapsed")}</TableHead>
                <TableHead>{t("board.common.time")}</TableHead>
                <TableHead>{t("board.common.client")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="mono3" style={MONO11}>XRANGE iot:raw - + COUNT 10000</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right", color: "var(--c-warn-text)" }}>48ms</TableCell>
                <TableCell className="mono3" style={MONO11}>10:02:37</TableCell>
                <TableCell className="mono3" style={MONO11}>10.2.3.9</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="mono3" style={MONO11}>XAUTOCLAIM orders:events …</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>18ms</TableCell>
                <TableCell className="mono3" style={MONO11}>09:41:22</TableCell>
                <TableCell className="mono3" style={MONO11}>10.2.3.4</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Panel>
      </PageBody>
    </Page>
  );
}
