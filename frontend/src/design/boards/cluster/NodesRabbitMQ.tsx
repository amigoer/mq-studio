import { Page, PageBody, PageHeader } from "@/design/shell";
import { Btn, Card, SectionLabel, Status, Table, TBody, TD, TH, THead, TR } from "@/design/ui";
import { Metric, NODE_CARD, NODE_GRID, NodeCard, TABLE_CARD } from "./_shared";
import { useTranslation } from "react-i18next";

const TAG = { fontSize: "10px" } as const;
const MONO11 = { fontSize: "11px" } as const;
const PLUGINS = ["management", "shovel", "federation", "delayed_exchange", "prometheus"];

/** Board 17b — RabbitMQ nodes. A memory alarm here triggers global flow control. */
export function NodesRabbitMQ() {
  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader title={t("board.common.node")} subtitle={t("board.cluster.rabbitmq.subtitle")} actions={<Btn>{t("board.common.refresh")}</Btn>} />
      <PageBody style={{ gap: "12px" }}>
        <div className={NODE_GRID}>
          <NodeCard
            name="rabbit@node1"
            badges={<Status tone="ok" style={TAG}>disc</Status>}
            address="10.3.0.1"
            metrics={
              <>
                <Metric label={t("board.cluster.rabbitmq.erlang")} value="42K" />
                <Metric label="fd" value="1.2K/65K" />
                <Metric label="socket" value="386/58K" />
              </>
            }
            meters={[
              { label: t("board.cluster.rabbitmq.mem48"), value: 48 },
              { label: t("board.cluster.rabbitmq.disk66"), value: 66 },
            ]}
          />
          <NodeCard
            name="rabbit@node2"
            badges={<Status tone="ok" style={TAG}>disc</Status>}
            address="10.3.0.2"
            metrics={
              <>
                <Metric label={t("board.cluster.rabbitmq.erlang")} value="40K" />
                <Metric label="fd" value="1.1K/65K" />
                <Metric label="socket" value="371/58K" />
              </>
            }
            meters={[
              { label: t("board.cluster.rabbitmq.mem52"), value: 52 },
              { label: t("board.cluster.rabbitmq.disk63"), value: 63 },
            ]}
          />
          <NodeCard
            name="rabbit@node3"
            badges={
              <>
                <Status tone="ok" style={TAG}>ram</Status>
                <Status tone="warn" style={TAG}>{t("board.cluster.rabbitmq.watermarkNear")}</Status>
              </>
            }
            address="10.3.0.3"
            metrics={
              <>
                <Metric label={t("board.cluster.rabbitmq.erlang")} value="48K" />
                <span style={{ color: "var(--c-warn-text)" }}>{t("board.cluster.rabbitmq.flowWarn")}</span>
              </>
            }
            meters={[{ label: t("board.cluster.rabbitmq.mem88"), value: 88, color: "var(--c-warn)" }]}
          />
          <Card style={NODE_CARD}>
            <SectionLabel>{t("board.cluster.rabbitmq.plugins")}</SectionLabel>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "2px" }}>
              {PLUGINS.map((p) => (
                <Status key={p} tone="off">
                  {p}
                </Status>
              ))}
            </div>
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
            <b style={{ fontSize: "12.5px" }}>{t("board.cluster.rabbitmq.versionPolicy")}</b>
            <span style={{ flex: 1 }} />
          </div>
          <Table>
            <THead>
              <TR>
                <TH>{t("board.cluster.rabbitmq.item")}</TH>
                <TH>{t("board.common.value")}</TH>
                <TH>{t("board.cluster.rabbitmq.item")}</TH>
                <TH>{t("board.common.value")}</TH>
              </TR>
            </THead>
            <TBody>
              <TR>
                <TD>RabbitMQ</TD>
                <TD className="mono3" style={MONO11}>3.13.2 · Erlang 26.2</TD>
                <TD>{t("board.cluster.rabbitmq.haPolicy")}</TD>
                <TD className="mono3" style={MONO11}>{t("board.cluster.rabbitmq.haValue")}</TD>
              </TR>
              <TR>
                <TD>{t("board.cluster.rabbitmq.vmMemory")}</TD>
                <TD className="mono3" style={MONO11}>0.6</TD>
                <TD>disk_free_limit</TD>
                <TD className="mono3" style={MONO11}>2 GB</TD>
              </TR>
            </TBody>
          </Table>
        </Card>
      </PageBody>
    </Page>
  );
}
