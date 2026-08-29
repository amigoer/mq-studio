import { useEffect, type CSSProperties } from "react";
import { Card } from "@/design/ui";

/** Board 9d — ⌘K search across every connection. */
export function CommandPalette({
  open,
  query,
  onQueryChange,
  onClose,
}: {
  open: boolean;
  query: string;
  onQueryChange?: (q: string) => void;
  onClose?: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(23,23,23,.32)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "90px",
        zIndex: 30,
      }}
      onClick={onClose}
    >
      <Card
        role="dialog"
        aria-label="全局搜索"
        style={{ width: "560px", overflow: "hidden", boxShadow: "0 18px 50px rgba(0,0,0,.22)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "13px 16px",
            borderBottom: "1px solid #ebebeb",
          }}
        >
          <span style={{ color: "#8a8a8a" }}>⌕</span>
          <input
            autoFocus
            value={query}
            onChange={(e) => onQueryChange?.(e.target.value)}
            placeholder="搜索 Topic / 消费者组 / 连接，或粘贴 MsgId"
            style={{
              flex: 1,
              font: "inherit",
              fontSize: "13.5px",
              border: "none",
              outline: "none",
              background: "transparent",
            }}
          />
          <span className="mono3" style={{ fontSize: "10px", color: "#a3a3a3" }}>
            ESC
          </span>
        </div>

        <div style={{ padding: "8px 8px 4px" }}>
          <div style={{ padding: "2px 10px 6px" }} className="sec3">
            rocketmq-order
          </div>
          <Row icon="▦" active name="ORDER_CREATE" meta="Topic · 堆积 982" enter />
          <Row icon="▦" name="ORDER_PAY_DELAY" meta="Topic" />
          <Row icon="◎" name="order-settle" meta="消费者组" pill="堆积 982" />
        </div>

        <div style={{ padding: "0 8px 4px" }}>
          <div style={{ padding: "8px 10px 6px" }} className="sec3">
            prod-kafka-cn
          </div>
          <Row icon="▦" name="orders.created" meta="Topic · 24 分区" />
        </div>

        <div style={{ padding: "0 8px 8px" }}>
          <div style={{ padding: "8px 10px 6px" }} className="sec3">
            操作
          </div>
          <div style={{ ...ROW, color: "#525252" }}>
            <span className="nic">➤</span>发送消息到 ORDER_CREATE…
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: "14px",
            padding: "9px 16px",
            borderTop: "1px solid #ebebeb",
            fontSize: "10.5px",
            color: "#a3a3a3",
          }}
        >
          <span>↑↓ 选择</span>
          <span>↵ 打开</span>
          <span>⌘↵ 新标签打开</span>
          <span style={{ flex: 1 }} />
          <span>粘贴 MsgId 直达消息</span>
        </div>
      </Card>
    </div>
  );
}

const ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  padding: "7px 10px",
  borderRadius: "8px",
  fontSize: "12.5px",
};

function Row({
  icon,
  name,
  meta,
  pill,
  active,
  enter,
}: {
  icon: string;
  name: string;
  meta: string;
  pill?: string;
  active?: boolean;
  enter?: boolean;
}) {
  return (
    <div style={{ ...ROW, background: active ? "#f5f5f5" : undefined, color: active ? undefined : "#525252" }}>
      <span className="nic">{icon}</span>
      {active ? (
        <b className="mono3" style={{ fontSize: "12px", fontWeight: 500 }}>
          {name}
        </b>
      ) : (
        <span className="mono3" style={{ fontSize: "12px" }}>
          {name}
        </span>
      )}
      {pill != null && (
        <span className="st warn" style={{ fontSize: "9.5px" }}>
          {pill}
        </span>
      )}
      <span style={{ fontSize: "10.5px", color: "#8a8a8a" }}>{meta}</span>
      {enter && (
        <>
          <span style={{ flex: 1 }} />
          <span className="mono3" style={{ fontSize: "10px", color: "#a3a3a3" }}>
            ↵ 打开
          </span>
        </>
      )}
    </div>
  );
}
