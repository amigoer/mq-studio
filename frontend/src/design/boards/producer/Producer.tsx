import { useState } from "react";
import { Page, PageHeader } from "@/design/shell";
import {
  Btn,
  Card,
  Field,
  IND,
  JNum,
  JStr,
  SectionLabel,
  Seg,
  SelectField,
  Status,
} from "@/design/ui";
import type { ProtocolId } from "@/design/data/protocols";
import { PROTOCOL_PANELS } from "./ProducerPanels";

const BODY_FORMATS = [
  { value: "json", label: "JSON" },
  { value: "text", label: "文本" },
  { value: "hex", label: "Hex" },
] as const;

const SEND_MODES = [
  { value: "sync", label: "同步" },
  { value: "async", label: "异步" },
  { value: "oneway", label: "单向" },
] as const;

/**
 * Board 3e — the send console. Left: target + body. Right: send options and a
 * protocol panel (16a-16e) that swaps wholesale with the active connection.
 */
export function Producer({ protocol }: { protocol: ProtocolId }) {
  const [format, setFormat] = useState<(typeof BODY_FORMATS)[number]["value"]>("json");
  const [sendMode, setSendMode] = useState<(typeof SEND_MODES)[number]["value"]>("sync");
  const Panel = PROTOCOL_PANELS[protocol];

  return (
    <Page>
      <PageHeader
        title="发送消息"
        subtitle="构造并发送测试消息 · 草稿自动保存"
        actions={
          <>
            <Btn>保存为模板</Btn>
            <Btn variant="primary">发送 ▸</Btn>
          </>
        }
      />

      <div style={{ flex: 1, display: "flex", gap: "16px", padding: "16px 20px", minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "12px" }}>
          <Card style={{ padding: "13px 16px", display: "flex", gap: "10px", alignItems: "center" }}>
            <SectionLabel style={{ flex: "none" }}>目标</SectionLabel>
            <TargetRow protocol={protocol} />
          </Card>

          <Card
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "10px 14px",
                borderBottom: "1px solid #ebebeb",
              }}
            >
              <Seg options={BODY_FORMATS} value={format} onChange={setFormat} />
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: "11.5px", color: "#29915d" }}>格式化</span>
              <span style={{ fontSize: "11.5px", color: "#8a8a8a" }}>从消息复制 ▾</span>
            </div>

            <div
              className="mono3 mqs-scroll"
              style={{
                flex: 1,
                minHeight: 0,
                padding: "12px 16px",
                fontSize: "11.5px",
                lineHeight: 1.8,
                color: "#525252",
              }}
            >
              {"{"}
              <br />
              {IND}"orderId": <JStr>"ORD-TEST-001"</JStr>,
              <br />
              {IND}"amount": <JNum>1.00</JNum>,
              <br />
              {IND}"scene": <JStr>"smoke-test"</JStr>
              <br />
              {"}"}
            </div>

            <div
              style={{
                borderTop: "1px solid #ebebeb",
                padding: "10px 14px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "11.5px",
              }}
            >
              <SectionLabel>自定义属性</SectionLabel>
              <Field className="mono3" style={{ fontSize: "11px" }} defaultValue="traceId = t-9f21" />
              <Field className="mono3" style={{ fontSize: "11px" }} defaultValue="env = staging" />
              <span style={{ color: "#29915d" }}>+ 添加</span>
            </div>
          </Card>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "9px 14px",
              border: "1px solid rgba(41,145,93,.35)",
              background: "rgba(41,145,93,.06)",
              borderRadius: "10px",
              fontSize: "12px",
            }}
          >
            <span style={{ color: "#1f7a4d" }}>✓ 发送成功</span>
            <span className="mono3" style={{ color: "#666", fontSize: "11px" }}>
              MsgId 7F0000012A9C…D02
            </span>
            <span style={{ flex: 1 }} />
            <span style={{ color: "#29915d" }}>查看该消息 →</span>
          </div>
        </div>

        <div
          style={{
            width: "300px",
            flex: "none",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            minHeight: 0,
          }}
        >
          <Card style={{ padding: "13px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <SectionLabel>发送选项</SectionLabel>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "12px" }}>
              <span>发送方式</span>
              <Seg options={SEND_MODES} value={sendMode} onChange={setSendMode} />
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "12px" }}>
              <span>发送次数</span>
              <Field style={{ width: "64px", textAlign: "right" }} defaultValue="1" />
            </div>
          </Card>

          <Card style={{ padding: "13px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <Panel />
          </Card>

          <Card style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            <SectionLabel style={{ padding: "11px 16px 8px" }}>最近发送</SectionLabel>
            <RecentSend tone="ok" label="成功" detail="ORDER_CREATE · 10:31" />
            <RecentSend tone="err" label="失败" detail="ORDER_PAY_DELAY · 09:58" />
            <div style={{ padding: "2px 16px 10px" }}>
              <div className="ph3" style={{ width: "70%" }} />
            </div>
          </Card>
        </div>
      </div>
    </Page>
  );
}

/** The target row; RabbitMQ addresses an exchange + routing key instead (16b). */
function TargetRow({ protocol }: { protocol: ProtocolId }) {
  if (protocol === "rabbitmq") {
    return (
      <>
        <SelectField style={{ flex: 1 }} value="Exchange：ex.order" />
        <Field
          className="mono3"
          style={{ flex: "0 0 200px" }}
          defaultValue="Routing Key：order.created"
        />
      </>
    );
  }
  if (protocol === "mqtt") {
    return (
      <>
        <Field className="mono3" style={{ flex: 1 }} defaultValue="主题：iot/device/cmd/A19F" />
        <SelectField style={{ flex: "0 0 130px" }} value="QoS 1" />
      </>
    );
  }
  if (protocol === "redis") {
    return (
      <>
        <SelectField style={{ flex: 1 }} value="Stream：orders:events" />
        <Field className="mono3" style={{ flex: "0 0 170px" }} defaultValue="Entry ID：*" />
      </>
    );
  }
  if (protocol === "pulsar") {
    return (
      <>
        <SelectField style={{ flex: 1 }} value="Topic：…/order-created" />
        <Field className="mono3" style={{ flex: "0 0 170px" }} defaultValue="Key：ORD-TEST-001" />
      </>
    );
  }
  if (protocol === "kafka") {
    return (
      <>
        <SelectField style={{ flex: 1 }} value="Topic：orders.created" />
        <Field className="mono3" style={{ flex: "0 0 170px" }} defaultValue="Key：ORD-TEST-001" />
      </>
    );
  }
  return (
    <>
      <SelectField style={{ flex: 1 }} value="Topic：ORDER_CREATE" />
      <Field style={{ flex: "0 0 130px" }} defaultValue="Tag：create" />
      <Field className="mono3" style={{ flex: "0 0 170px" }} defaultValue="Keys：ORD-TEST-001" />
    </>
  );
}

function RecentSend({
  tone,
  label,
  detail,
}: {
  tone: "ok" | "err";
  label: string;
  detail: string;
}) {
  return (
    <div
      style={{
        padding: "0 16px 6px",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        fontSize: "11.5px",
      }}
    >
      <Status tone={tone} style={{ fontSize: "10px" }}>
        {label}
      </Status>
      <span
        className="mono3"
        style={{
          color: "#666",
          fontSize: "10.5px",
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {detail}
      </span>
      <span style={{ color: "#29915d" }}>重用</span>
    </div>
  );
}
