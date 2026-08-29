import { Page, PageBody, PageHeader } from "@/design/shell";
import { Btn, Card, KV, SectionLabel, Status, Table, TBody, TD, TH, THead, TR } from "@/design/ui";
import { Metric, NODE_CARD, NODE_GRID, NodeCard, TABLE_CARD } from "./_shared";

const TAG = { fontSize: "10px" } as const;
const MONO11 = { fontSize: "11px" } as const;

/** Board 17d — Redis is a single instance: INFO, persistence, slow log. */
export function NodeRedis() {
  return (
    <Page>
      <PageHeader title="节点" subtitle="redis-stream-01 · 单机 · Redis 7.2.4" actions={<Btn>刷新</Btn>} />
      <PageBody style={{ gap: "12px" }}>
        <div className={NODE_GRID}>
          <NodeCard
            name="10.2.0.8:6379"
            badges={<Status tone="ok" style={TAG}>master</Status>}
            address="uptime 96d"
            metrics={
              <>
                <Metric label="ops" value="3 420/s" />
                <Metric label="连接" value="86" />
                <Metric label="命中率" value="99.2%" />
              </>
            }
            meters={[{ label: "内存 412MB / 2GB 20%", value: 20 }]}
          />
          <Card style={NODE_CARD}>
            <SectionLabel>持久化</SectionLabel>
            <KV
              rows={[
                ["AOF", <span className="mono3" style={MONO11}>everysec · 重写 02:00</span>],
                ["RDB", <span className="mono3" style={MONO11}>最近 08:00 · 耗时 1.2s</span>],
                ["复制", <span className="mono3" style={MONO11}>无副本（单机）</span>],
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
            <b style={{ fontSize: "12.5px" }}>慢日志（&gt;10ms）</b>
            <span style={{ flex: 1 }} />
          </div>
          <Table>
            <THead>
              <TR>
                <TH>命令</TH>
                <TH style={{ textAlign: "right" }}>耗时</TH>
                <TH>时间</TH>
                <TH>客户端</TH>
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
