import { ArrowLeft, Plus } from "lucide-react";
import { Page, PageBody, PageHeader } from "@/design/shell";
import { Placeholder, SectionLabel } from "@/design/ui";
import { ProtocolIcon } from "@/design/icons/ProtocolIcon";

const DASHED = {
  border: "1.5px dashed var(--c-border-strong)",
  borderRadius: "12px",
} as const;

const TAB_ACTIVE = {
  border: "1px solid var(--c-border)",
  borderRadius: "7px",
  padding: "3px 10px",
  fontSize: "11px",
  background: "var(--c-bg)",
  boxShadow: "0 1px 2px rgba(0,0,0,.05)",
  whiteSpace: "nowrap",
  display: "inline-flex",
  alignItems: "center",
  gap: "5px",
} as const;

const TAB_IDLE = {
  borderRadius: "7px",
  padding: "3px 10px",
  fontSize: "11px",
  color: "var(--c-muted)",
  whiteSpace: "nowrap",
  display: "inline-flex",
  alignItems: "center",
  gap: "5px",
} as const;

/** Board 5c — the three-layer navigation model and where state is isolated. */
export function NavModel() {
  return (
    <Page>
      <PageHeader
        title="导航模型"
        subtitle="三层结构与隔离边界：窗口 → 连接标签 → 页面；标签间状态完全隔离，拖出=新窗口、并排=分屏"
      />
      <PageBody>
        <div
          style={{
            maxWidth: "700px",
            width: "100%",
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            fontSize: "12px",
            lineHeight: 1.6,
          }}
        >
          <div style={{ ...DASHED, padding: "12px" }}>
            <SectionLabel style={{ marginBottom: "8px" }}>窗口 A（可多开）</SectionLabel>
            <div style={{ display: "flex", gap: "6px", marginBottom: "8px", flexWrap: "wrap" }}>
              <span style={TAB_ACTIVE}>
                <ProtocolIcon protocol="rocketmq" size={12} />
                rocketmq-order
              </span>
              <span style={TAB_IDLE}>
                <ProtocolIcon protocol="kafka" size={12} />
                prod-kafka-cn
              </span>
              <span
                style={{
                  display: "inline-flex",
                  borderRadius: "7px",
                  padding: "3px 10px",
                  color: "var(--c-muted)",
                }}
              >
                <Plus size={12} aria-hidden />
              </span>
              <span style={{ flex: 1 }} />
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  fontSize: "10.5px",
                  color: "var(--c-muted)",
                }}
              >
                <ArrowLeft size={12} aria-hidden />
                连接标签层（隔离边界）
              </span>
            </div>
            <div
              style={{
                border: "1px solid var(--c-border)",
                borderRadius: "8px",
                padding: "10px",
                display: "flex",
                gap: "10px",
                background: "var(--c-panel)",
              }}
            >
              <div
                style={{
                  width: "110px",
                  fontSize: "10.5px",
                  color: "var(--c-mono-dim)",
                  lineHeight: 1.9,
                  borderRight: "1px solid var(--c-border)",
                  paddingRight: "10px",
                }}
              >
                总览
                <br />
                <b style={{ color: "var(--c-fg)" }}>
                  消息 <ArrowLeft size={11} style={{ verticalAlign: "-1px" }} aria-hidden />
                </b>
                <br />
                Topic
                <br />
                消费者 …
              </div>
              <div
                style={{
                  flex: 1,
                  fontSize: "10.5px",
                  color: "var(--c-muted)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  justifyContent: "center",
                }}
              >
                <span>页面层：每个标签自己的侧边栏位置、筛选、滚动、查询结果</span>
                <Placeholder width="70%" />
                <Placeholder width="52%" />
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: "12px", alignItems: "stretch" }}>
            <div style={{ ...DASHED, flex: 1, padding: "10px 12px", fontSize: "11px", color: "var(--c-mono-dim)" }}>
              <b style={{ color: "var(--c-fg)" }}>拖出标签 → 窗口 B</b>
              <br />
              双显示器各盯一个集群（Wails 多窗口）
            </div>
            <div style={{ ...DASHED, flex: 1, padding: "10px 12px", fontSize: "11px", color: "var(--c-mono-dim)" }}>
              <b style={{ color: "var(--c-fg)" }}>两个标签并排 → 分屏对照</b>
              <br />
              迁移/双写核对两边堆积与消息
            </div>
          </div>

          <div style={{ fontSize: "11px", color: "var(--c-muted)", lineHeight: 1.7 }}>
            隔离内容：页面状态 · 查询缓存 · 自动刷新定时器 · 凭证会话 · 告警订阅。全局共享：设置 ·
            连接配置库 · 告警通知中心。
          </div>
        </div>
      </PageBody>
    </Page>
  );
}
