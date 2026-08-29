import type { ReactNode } from "react";
import { Page, PageBody, PageHeader } from "@/design/shell";
import { Status, Table, TBody, TD, TH, THead, TR } from "@/design/ui";

type Strategy = "reuse" | "adapt" | "separate";

const TONE: Record<Strategy, { tone: "ok" | "warn" | "err"; label: string }> = {
  reuse: { tone: "ok", label: "复用" },
  adapt: { tone: "warn", label: "适配复用" },
  separate: { tone: "err", label: "独立" },
};

const ROWS: readonly { page: string; strategy: Strategy; note: ReactNode }[] = [
  {
    page: "连接管理 · 设置 · 告警",
    strategy: "reuse",
    note: "全协议同一套，仅连接表单字段随协议切换（3a）",
  },
  {
    page: "总览 · Topic · 消息查询 · 发送 · 消费者组 · 死信 · 节点",
    strategy: "adapt",
    note: "同一页面骨架 + 协议字段映射与显隐，按 3h 矩阵裁剪（例：3c→4c）",
  },
  {
    page: "RabbitMQ 队列 / 交换机 / 绑定",
    strategy: "separate",
    note: "AMQP 专属模型，独立导航与页面（4a），表格/详情面板等基础组件仍共享",
  },
  {
    page: "MQTT 主题树 + 实时订阅工作台",
    strategy: "separate",
    note: "无持久检索与消费组模型（4b），发布面板复用生产者骨架",
  },
  {
    page: "Pulsar 租户 / 命名空间层级",
    strategy: "adapt",
    note: "Topic 页顶部加 tenant / namespace 级联选择，其余同 Kafka 视图",
  },
  {
    page: "Redis Stream PEL / claim",
    strategy: "adapt",
    note: "消费者组页内加 PEL（待确认列表）表和 XCLAIM 操作",
  },
];

/** Board 4d — how each page is built across protocols. */
export function ReuseStrategy() {
  return (
    <Page>
      <PageHeader
        title="页面复用策略"
        subtitle="前端按「协议适配器 + 能力描述」渲染：体验优先，复用其次（配合 3h 能力矩阵使用）"
      />
      <PageBody>
        <div style={{ maxWidth: "860px", width: "100%", margin: "0 auto" }}>
          <Table style={{ fontSize: "11.5px" }}>
            <THead>
              <TR>
                <TH style={{ width: "260px" }}>页面</TH>
                <TH style={{ width: "110px" }}>策略</TH>
                <TH>说明</TH>
              </TR>
            </THead>
            <TBody>
              {ROWS.map((row) => (
                <TR key={row.page}>
                  <TD>{row.page}</TD>
                  <TD>
                    <Status tone={TONE[row.strategy].tone}>{TONE[row.strategy].label}</Status>
                  </TD>
                  <TD style={{ whiteSpace: "normal", color: "#666" }}>{row.note}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <div style={{ padding: "10px 14px 6px", fontSize: "11px", color: "#8a8a8a" }}>
            实现建议：每种协议一个 adapter，暴露统一接口 + capabilities 描述；页面按 capabilities
            渲染字段与操作，独立模块走协议专属路由。
          </div>
        </div>
      </PageBody>
    </Page>
  );
}
