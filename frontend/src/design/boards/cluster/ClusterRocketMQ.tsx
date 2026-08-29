import { Page, PageBody, PageHeader } from "@/design/shell";
import { Btn, Card, Status, Table, TBody, TD, TH, THead, TR } from "@/design/ui";
import { Metric, NODE_GRID, NodeCard, TABLE_CARD } from "./_shared";
import { useTranslation } from "react-i18next";

const TAG = { fontSize: "10px" } as const;
const MONO11 = { fontSize: "11px" } as const;

/** Board 3f — RocketMQ brokers and name servers. */
export function ClusterRocketMQ() {
  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader
        title={t("board.cluster.rocketmq.title")}
        subtitle={t("board.cluster.rocketmq.subtitle")}
        actions={<Btn>{t("board.common.refresh")}</Btn>}
      />
      <PageBody style={{ gap: "12px" }}>
        <div className={NODE_GRID}>
          <NodeCard
            name="broker-a"
            badges={<Status tone="ok" style={TAG}>MASTER</Status>}
            address="10.12.3.51:10911 · 42d"
            metrics={
              <>
                <Metric label={t("board.common.in")} value="1 620/s" />
                <Metric label={t("board.common.out")} value="1 588/s" />
                <span style={{ color: "var(--c-muted)" }}>PageCache 0.3ms</span>
              </>
            }
            meters={[{ label: t("board.cluster.rocketmq.disk61"), value: 61 }]}
          />
          <NodeCard
            name="broker-b"
            badges={
              <>
                <Status tone="ok" style={TAG}>MASTER</Status>
                <Status tone="warn" style={TAG}>{t("board.cluster.rocketmq.diskAlert")}</Status>
              </>
            }
            address="10.12.3.53:10911 · 42d"
            metrics={
              <>
                <Metric label={t("board.common.in")} value="1 604/s" />
                <Metric label={t("board.common.out")} value="1 530/s" />
                <span style={{ color: "var(--c-muted)" }}>PageCache 0.4ms</span>
              </>
            }
            meters={[{ label: t("board.cluster.rocketmq.disk87"), value: 87, color: "var(--c-warn)", labelColor: "var(--c-warn-text)" }]}
          />
          <NodeCard
            dim
            name="broker-a-s"
            badges={<Status tone="off" style={TAG}>SLAVE</Status>}
            address="10.12.3.52:10911"
            metrics={
              <span style={{ color: "var(--c-mono-dim)" }}>
                {t("board.cluster.rocketmq.syncBehind")} <b className="mono3">0</b>
              </span>
            }
            meters={[{ label: t("board.cluster.rocketmq.disk60"), value: 60, color: "var(--c-muted-2)" }]}
          />
          <NodeCard
            dim
            name="broker-b-s"
            badges={<Status tone="off" style={TAG}>SLAVE</Status>}
            address="10.12.3.54:10911"
            metrics={
              <span style={{ color: "var(--c-mono-dim)" }}>
                {t("board.cluster.rocketmq.syncBehind")} <b className="mono3">128</b>
              </span>
            }
            meters={[{ label: t("board.cluster.rocketmq.disk66"), value: 66, color: "var(--c-muted-2)" }]}
          />
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
            <b style={{ fontSize: "12.5px" }}>{t("board.cluster.rocketmq.nameserver")}</b>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: "11.5px", color: "var(--c-ok)" }}>{t("board.cluster.rocketmq.copyDiagnostics")}</span>
          </div>
          <Table>
            <THead>
              <TR>
                <TH>{t("board.common.address")}</TH>
                <TH>{t("board.common.role")}</TH>
                <TH style={{ textAlign: "right" }}>RT</TH>
                <TH>{t("board.cluster.rocketmq.flush")}</TH>
                <TH>{t("board.cluster.rocketmq.commitLogLatency")}</TH>
              </TR>
            </THead>
            <TBody>
              <TR>
                <TD className="mono3" style={MONO11}>10.12.3.44:9876</TD>
                <TD>NameServer</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>2ms</TD>
                <TD>ASYNC_FLUSH</TD>
                <TD className="mono3">0</TD>
              </TR>
              <TR>
                <TD className="mono3" style={MONO11}>10.12.3.45:9876</TD>
                <TD>NameServer</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>3ms</TD>
                <TD>—</TD>
                <TD className="mono3">—</TD>
              </TR>
            </TBody>
          </Table>
        </Card>
      </PageBody>
    </Page>
  );
}
