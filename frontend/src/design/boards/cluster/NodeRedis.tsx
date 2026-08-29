import { Page, PageBody, PageHeader } from "@/design/shell";
import { Btn, Card, KV, SectionLabel, Status, Table, TBody, TD, TH, THead, TR } from "@/design/ui";
import { Metric, NODE_CARD, NODE_GRID, NodeCard, TABLE_CARD } from "./_shared";
import { useTranslation } from "react-i18next";

const TAG = { fontSize: "10px" } as const;
const MONO11 = { fontSize: "11px" } as const;

/** Board 17d — Redis is a single instance: INFO, persistence, slow log. */
export function NodeRedis() {
  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader title={t("board.common.node")} subtitle={t("board.cluster.redis.subtitle")} actions={<Btn>{t("board.common.refresh")}</Btn>} />
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
          <Card style={NODE_CARD}>
            <SectionLabel>{t("board.common.persistence")}</SectionLabel>
            <KV
              rows={[
                ["AOF", <span className="mono3" style={MONO11}>{t("board.cluster.redis.aof")}</span>],
                ["RDB", <span className="mono3" style={MONO11}>{t("board.cluster.redis.rdb")}</span>],
                [t("board.common.copy"), <span className="mono3" style={MONO11}>{t("board.cluster.redis.noReplica")}</span>],
              ]}
            />
          </Card>
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
            <b style={{ fontSize: "12.5px" }}>{t("board.cluster.redis.slowlog")}</b>
            <span style={{ flex: 1 }} />
          </div>
          <Table>
            <THead>
              <TR>
                <TH>{t("board.cluster.redis.command")}</TH>
                <TH style={{ textAlign: "right" }}>{t("board.cluster.redis.elapsed")}</TH>
                <TH>{t("board.common.time")}</TH>
                <TH>{t("board.common.client")}</TH>
              </TR>
            </THead>
            <TBody>
              <TR>
                <TD className="mono3" style={MONO11}>XRANGE iot:raw - + COUNT 10000</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-warn-text)" }}>48ms</TD>
                <TD className="mono3" style={MONO11}>10:02:37</TD>
                <TD className="mono3" style={MONO11}>10.2.3.9</TD>
              </TR>
              <TR>
                <TD className="mono3" style={MONO11}>XAUTOCLAIM orders:events …</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>18ms</TD>
                <TD className="mono3" style={MONO11}>09:41:22</TD>
                <TD className="mono3" style={MONO11}>10.2.3.4</TD>
              </TR>
            </TBody>
          </Table>
        </Card>
      </PageBody>
    </Page>
  );
}
