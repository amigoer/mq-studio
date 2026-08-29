import { Page, PageBody, PageHeader } from "@/design/shell";
import { Btn, Card, SectionLabel, Status, Table, TBody, TD, TH, THead, TR } from "@/design/ui";
import { Metric, NODE_CARD, NODE_GRID, NodeCard, TABLE_CARD } from "./_shared";

const TAG = { fontSize: "10px" } as const;
const MONO11 = { fontSize: "11px" } as const;
const PLUGINS = ["management", "shovel", "federation", "delayed_exchange", "prometheus"];

/** Board 17b — RabbitMQ nodes. A memory alarm here triggers global flow control. */
export function NodesRabbitMQ() {
  return (
    <Page>
      <PageHeader title="节点" subtitle="集群 rabbit@cluster · 3 节点" actions={<Btn>刷新</Btn>} />
      <PageBody style={{ gap: "12px" }}>
        <div className={NODE_GRID}>
          <NodeCard
            name="rabbit@node1"
            badges={<Status tone="ok" style={TAG}>disc</Status>}
            address="10.3.0.1"
            metrics={
              <>
                <Metric label="Erlang 进程" value="42K" />
                <Metric label="fd" value="1.2K/65K" />
                <Metric label="socket" value="386/58K" />
              </>
            }
            meters={[
              { label: "内存 48%", value: 48 },
              { label: "磁盘 free 剩余 66%", value: 66 },
            ]}
          />
          <NodeCard
            name="rabbit@node2"
            badges={<Status tone="ok" style={TAG}>disc</Status>}
            address="10.3.0.2"
            metrics={
              <>
                <Metric label="Erlang 进程" value="40K" />
                <Metric label="fd" value="1.1K/65K" />
                <Metric label="socket" value="371/58K" />
              </>
            }
            meters={[
              { label: "内存 52%", value: 52 },
              { label: "磁盘 free 剩余 63%", value: 63 },
            ]}
          />
          <NodeCard
            name="rabbit@node3"
            badges={
              <>
                <Status tone="ok" style={TAG}>ram</Status>
                <Status tone="warn" style={TAG}>高水位逼近</Status>
              </>
            }
            address="10.3.0.3"
            metrics={
              <>
                <Metric label="Erlang 进程" value="48K" />
                <span style={{ color: "var(--c-warn-text)" }}>内存告警会触发全局 flow</span>
              </>
            }
            meters={[{ label: "内存 88%", value: 88, color: "var(--c-warn)" }]}
          />
          <Card style={NODE_CARD}>
            <SectionLabel>已启用插件</SectionLabel>
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
            <b style={{ fontSize: "12.5px" }}>版本 / 策略</b>
            <span style={{ flex: 1 }} />
          </div>
          <Table>
            <THead>
              <TR>
                <TH>项</TH>
                <TH>值</TH>
                <TH>项</TH>
                <TH>值</TH>
              </TR>
            </THead>
            <TBody>
              <TR>
                <TD>RabbitMQ</TD>
                <TD className="mono3" style={MONO11}>3.13.2 · Erlang 26.2</TD>
                <TD>HA 策略</TD>
                <TD className="mono3" style={MONO11}>quorum 默认 · classic 无镜像</TD>
              </TR>
              <TR>
                <TD>vm_memory 高水位</TD>
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
