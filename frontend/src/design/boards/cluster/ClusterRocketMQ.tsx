import { Page, PageBody, PageHeader } from "@/design/shell";
import { Btn, Card, Status, Table, TBody, TD, TH, THead, TR } from "@/design/ui";
import { Metric, NODE_GRID, NodeCard, TABLE_CARD } from "./_shared";

const TAG = { fontSize: "10px" } as const;
const MONO11 = { fontSize: "11px" } as const;

/** Board 3f — RocketMQ brokers and name servers. */
export function ClusterRocketMQ() {
  return (
    <Page>
      <PageHeader
        title="集群 · DefaultCluster"
        subtitle="RocketMQ 5.1.4 · 2 NameServer · 2 主 2 从"
        actions={<Btn>刷新</Btn>}
      />
      <PageBody style={{ gap: "12px" }}>
        <div className={NODE_GRID}>
          <NodeCard
            name="broker-a"
            badges={<Status tone="ok" style={TAG}>MASTER</Status>}
            address="10.12.3.51:10911 · 42d"
            metrics={
              <>
                <Metric label="入" value="1 620/s" />
                <Metric label="出" value="1 588/s" />
                <span style={{ color: "var(--c-muted)" }}>PageCache 0.3ms</span>
              </>
            }
            meters={[{ label: "磁盘 61%", value: 61 }]}
          />
          <NodeCard
            name="broker-b"
            badges={
              <>
                <Status tone="ok" style={TAG}>MASTER</Status>
                <Status tone="warn" style={TAG}>磁盘告警</Status>
              </>
            }
            address="10.12.3.53:10911 · 42d"
            metrics={
              <>
                <Metric label="入" value="1 604/s" />
                <Metric label="出" value="1 530/s" />
                <span style={{ color: "var(--c-muted)" }}>PageCache 0.4ms</span>
              </>
            }
            meters={[{ label: "磁盘 87%", value: 87, color: "var(--c-warn)", labelColor: "var(--c-warn-text)" }]}
          />
          <NodeCard
            dim
            name="broker-a-s"
            badges={<Status tone="off" style={TAG}>SLAVE</Status>}
            address="10.12.3.52:10911"
            metrics={
              <span style={{ color: "var(--c-mono-dim)" }}>
                同步复制 · 落后 <b className="mono3">0</b>
              </span>
            }
            meters={[{ label: "磁盘 60%", value: 60, color: "var(--c-muted-2)" }]}
          />
          <NodeCard
            dim
            name="broker-b-s"
            badges={<Status tone="off" style={TAG}>SLAVE</Status>}
            address="10.12.3.54:10911"
            metrics={
              <span style={{ color: "var(--c-mono-dim)" }}>
                同步复制 · 落后 <b className="mono3">128</b>
              </span>
            }
            meters={[{ label: "磁盘 66%", value: 66, color: "var(--c-muted-2)" }]}
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
            <b style={{ fontSize: "12.5px" }}>NameServer / 运行指标</b>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: "11.5px", color: "var(--c-ok)" }}>复制诊断信息</span>
          </div>
          <Table>
            <THead>
              <TR>
                <TH>地址</TH>
                <TH>角色</TH>
                <TH style={{ textAlign: "right" }}>RT</TH>
                <TH>刷盘</TH>
                <TH>CommitLog 延迟</TH>
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
