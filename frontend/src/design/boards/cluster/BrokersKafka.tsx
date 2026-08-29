import { Page, PageBody, PageHeader } from "@/design/shell";
import { Btn, Card, KV, SectionLabel, Status, Table, TBody, TD, TH, THead, TR } from "@/design/ui";
import { Metric, NODE_CARD, NODE_GRID, NodeCard, TABLE_CARD } from "./_shared";

const TAG = { fontSize: "10px" } as const;
const MONO11 = { fontSize: "11px" } as const;

/** Board 17a — Kafka brokers: controller star, URP and ISR shrink warnings. */
export function BrokersKafka() {
  return (
    <Page>
      <PageHeader
        title="Broker"
        subtitle="Kafka 3.7 · KRaft · Controller kafka-1"
        actions={<Btn>刷新</Btn>}
      />
      <PageBody style={{ gap: "12px" }}>
        <div style={NODE_GRID}>
          <NodeCard
            name="kafka-1"
            badges={<Status tone="ok" style={TAG}>Controller ★</Status>}
            address="rack-a · 9092"
            metrics={
              <>
                <Metric label="入" value="1 820/s" />
                <Metric label="出" value="3 240/s" />
                <span style={{ color: "#8a8a8a" }}>分区 130 · leader 44</span>
              </>
            }
            meters={[{ label: "磁盘 58%", value: 58 }]}
          />
          <NodeCard
            name="kafka-2"
            badges={<Status tone="ok" style={TAG}>Broker</Status>}
            address="rack-b · 9092"
            metrics={
              <>
                <Metric label="入" value="1 704/s" />
                <Metric label="出" value="2 988/s" />
                <span style={{ color: "#8a8a8a" }}>分区 128 · leader 42</span>
              </>
            }
            meters={[{ label: "磁盘 61%", value: 61 }]}
          />
          <NodeCard
            name="kafka-3"
            badges={
              <>
                <Status tone="ok" style={TAG}>Broker</Status>
                <Status tone="warn" style={TAG}>ISR 收缩</Status>
              </>
            }
            address="rack-c · 9092"
            metrics={
              <>
                <Metric label="入" value="1 688/s" />
                <Metric label="出" value="2 901/s" />
                <span style={{ color: "#b45309" }}>URP 2</span>
              </>
            }
            meters={[{ label: "磁盘 74%", value: 74, color: "#d97706" }]}
          />
          <Card style={NODE_CARD}>
            <SectionLabel>集群配置摘要</SectionLabel>
            <KV
              rows={[
                ["min.insync.replicas", <span className="mono3" style={MONO11}>2</span>],
                ["default.replication", <span className="mono3" style={MONO11}>3</span>],
                ["auto.create.topics", <span className="mono3" style={MONO11}>false</span>],
              ]}
            />
          </Card>
        </div>

        <Card style={TABLE_CARD}>
          <div
            style={{
              padding: "11px 16px",
              borderBottom: "1px solid #ebebeb",
              display: "flex",
              alignItems: "center",
            }}
          >
            <b style={{ fontSize: "12.5px" }}>未同步分区（URP）</b>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: "11.5px", color: "#525252" }}>重新选举 leader…</span>
          </div>
          <Table>
            <THead>
              <TR>
                <TH>Topic</TH>
                <TH style={{ textAlign: "right" }}>分区</TH>
                <TH>ISR</TH>
                <TH>缺失副本</TH>
              </TR>
            </THead>
            <TBody>
              <TR>
                <TD className="mono3" style={MONO11}>orders.created</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>2</TD>
                <TD className="mono3" style={MONO11}>3,1</TD>
                <TD className="mono3" style={{ ...MONO11, color: "#b45309" }}>
                  2（kafka-2 落后 4 210）
                </TD>
              </TR>
              <TR>
                <TD className="mono3" style={MONO11}>payments.captured</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>7</TD>
                <TD className="mono3" style={MONO11}>1,2</TD>
                <TD className="mono3" style={{ ...MONO11, color: "#b45309" }}>3（追赶中）</TD>
              </TR>
            </TBody>
          </Table>
        </Card>
      </PageBody>
    </Page>
  );
}
