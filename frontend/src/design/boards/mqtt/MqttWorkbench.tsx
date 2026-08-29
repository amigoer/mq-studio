import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Toolbar } from "@/design/shell";
import {
  Btn,
  Field,
  JNum,
  JsonBlock,
  IND,
  KV,
  Placeholder,
  SectionLabel,
  SelectField,
  Status,
} from "@/design/ui";

const MONO11 = { fontSize: "11px" } as const;
const KV_NARROW = { gridTemplateColumns: "76px 1fr" } as const;

type Live = { time: string; topic: string; qos: string; payload: string; active?: boolean };

const LIVE: readonly Live[] = [
  { time: "10:24:07.221", topic: "iot/device/telemetry/A19F", qos: "QoS 1", payload: '{"temp":23.4,"hum":61,"bat":0.87}', active: true },
  { time: "10:24:07.480", topic: "iot/device/telemetry/B22C", qos: "QoS 0", payload: '{"temp":22.1,"hum":58,"bat":0.92}' },
  { time: "10:24:08.010", topic: "iot/device/status/A19F", qos: "QoS 1 · R", payload: "online" },
];

/**
 * Board 4b — the MQTT workbench. There is no durable search or consumer-group
 * model here, so the page is a topic tree, a live subscription stream, and a
 * detail column, rather than the list + sheet used by every other protocol.
 */

/** A branch in the 11e topic tree: the canvas drew its caret as ▾ / ▸. */
function TreeNode({
  children,
  indent,
  open = false,
  color = "var(--c-fg-2)",
}: {
  children: ReactNode;
  indent: string;
  open?: boolean;
  color?: string;
}) {
  const Caret = open ? ChevronDown : ChevronRight;
  return (
    <div style={{ padding: indent, color, display: "flex", alignItems: "center", gap: "4px" }}>
      <Caret size={12} aria-hidden />
      {children}
    </div>
  );
}

export function MqttWorkbench() {
  const [selected, setSelected] = useState(0);

  return (
    <div style={{ flex: 1, display: "flex", minWidth: 0 }}>
      {/* topic tree */}
      <div
        style={{
          width: "216px",
          flex: "none",
          borderRight: "1px solid var(--c-border)",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <div style={{ padding: "12px 14px 8px", display: "flex", alignItems: "center" }}>
          <SectionLabel>主题树</SectionLabel>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: "11px", color: "var(--c-ok)" }}>+ 订阅</span>
        </div>
        <div
          style={{
            padding: "0 8px",
            fontSize: "12px",
            display: "flex",
            flexDirection: "column",
            gap: "1px",
          }}
        >
          <TreeNode indent="4px 8px" open>
            iot
          </TreeNode>
          <TreeNode indent="4px 8px 4px 22px" open>
            device
          </TreeNode>
          <div
            style={{
              padding: "4px 8px 4px 36px",
              borderRadius: "6px",
              background: "var(--c-fg)",
              color: "var(--c-bg)",
              fontWeight: 500,
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            telemetry/#
            <span
              className="mono3"
              style={{ fontSize: "10px", color: "rgba(255,255,255,.65)", marginLeft: "auto" }}
            >
              12/s
            </span>
          </div>
          <div style={{ padding: "4px 8px 4px 36px", color: "var(--c-fg-2)", display: "flex", gap: "6px" }}>
            status/#
            <span className="mono3" style={{ fontSize: "10px", color: "var(--c-muted-2)", marginLeft: "auto" }}>
              2/s
            </span>
          </div>
          <TreeNode indent="4px 8px 4px 22px">cmd</TreeNode>
          <TreeNode indent="4px 8px" color="var(--c-muted)">
            $SYS
          </TreeNode>
        </div>
        <div style={{ flex: 1 }} />
        <div
          style={{
            margin: "10px",
            padding: "9px 11px",
            border: "1px dashed var(--c-border-strong)",
            borderRadius: "8px",
            fontSize: "10.5px",
            color: "var(--c-muted)",
          }}
        >
          已订阅 2 · 缓冲 2 000 条
          <br />
          断开后订阅自动恢复
        </div>
      </div>

      {/* live stream */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          borderRight: "1px solid var(--c-border)",
        }}
      >
        <Toolbar style={{ borderBottom: "1px solid var(--c-border)" }}>
          <Status tone="ok" dot style={{ fontSize: "10.5px" }}>
            订阅中
          </Status>
          <span className="mono3" style={{ fontSize: "11px", color: "var(--c-mono-dim)" }}>
            iot/device/telemetry/# · QoS 1
          </span>
          <span style={{ flex: 1 }} />
          <Btn>暂停</Btn>
          <Btn>清空</Btn>
        </Toolbar>
        <Toolbar style={{ padding: "8px 14px" }}>
          <Field style={{ flex: 1 }} placeholder="payload 关键字过滤…" />
          <SelectField value="全部 QoS" />
        </Toolbar>

        <div className="mqs-scroll" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {LIVE.map((row, i) => (
            <button
              key={row.time}
              type="button"
              onClick={() => setSelected(i)}
              style={{
                textAlign: "left",
                font: "inherit",
                border: "none",
                padding: "8px 14px",
                background: i === selected ? "rgba(41,145,93,.06)" : "transparent",
                borderBottom: "1px solid var(--c-rule)",
                display: "flex",
                flexDirection: "column",
                gap: "2px",
              }}
            >
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <span className="mono3" style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>
                  {row.time}
                </span>
                <span
                  className="mono3"
                  style={{ fontSize: "11.5px", fontWeight: row.active ? 500 : undefined }}
                >
                  {row.topic}
                </span>
                <span style={{ flex: 1 }} />
                <Status tone="off" style={{ fontSize: "9.5px" }}>
                  {row.qos}
                </Status>
              </div>
              <div
                className="mono3"
                style={{
                  fontSize: "10.5px",
                  color: "var(--c-muted)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {row.payload}
              </div>
            </button>
          ))}
          <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: "10px" }}>
            {["86%", "70%", "92%", "64%", "78%"].map((w) => (
              <Placeholder key={w} width={w} />
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <div
            style={{
              padding: "8px 14px",
              borderTop: "1px solid var(--c-border)",
              fontSize: "10.5px",
              color: "var(--c-muted)",
              display: "flex",
            }}
          >
            <span>412 msg/s · 自动滚动</span>
            <span style={{ flex: 1 }} />
            <span style={{ color: "var(--c-ok)" }}>导出 NDJSON</span>
          </div>
        </div>
      </div>

      {/* detail */}
      <div
        style={{
          width: "320px",
          flex: "none",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          background: "var(--c-panel)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "12px 16px",
            borderBottom: "1px solid var(--c-border)",
            background: "var(--c-bg)",
          }}
        >
          <b style={{ fontSize: "12.5px" }}>消息详情</b>
          <span style={{ flex: 1 }} />
          <Btn>复制</Btn>
        </div>

        <div
          className="mqs-scroll"
          style={{
            flex: 1,
            minHeight: 0,
            padding: "12px 16px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <KV
            style={KV_NARROW}
            rows={[
              ["主题", <span className="mono3" style={MONO11}>iot/device/telemetry/A19F</span>],
              ["QoS / Retain", "1 / false"],
              ["时间", <span className="mono3" style={MONO11}>10:24:07.221</span>],
            ]}
          />

          <div>
            <SectionLabel style={{ marginBottom: "6px" }}>Payload · JSON</SectionLabel>
            <JsonBlock>
              {"{"}
              <br />
              {IND}"temp": <JNum>23.4</JNum>,
              <br />
              {IND}"hum": <JNum>61</JNum>,
              <br />
              {IND}"bat": <JNum>0.87</JNum>
              <br />
              {"}"}
            </JsonBlock>
          </div>

          <div>
            <SectionLabel style={{ marginBottom: "6px" }}>用户属性 · MQTT 5</SectionLabel>
            <KV
              style={KV_NARROW}
              rows={[
                ["deviceType", <span className="mono3" style={MONO11}>sensor-v3</span>],
                ["expiry", <span className="mono3" style={MONO11}>3600s</span>],
              ]}
            />
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: "8px",
            padding: "12px 16px",
            borderTop: "1px solid var(--c-border)",
            background: "var(--c-bg)",
          }}
        >
          <Btn>历史同主题</Btn>
          <span style={{ flex: 1 }} />
          <Btn variant="primary">以此为模板发布</Btn>
        </div>
      </div>
    </div>
  );
}
