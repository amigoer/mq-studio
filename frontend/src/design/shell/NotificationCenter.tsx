import { useEffect, useRef, type ReactNode } from "react";
import { ProtocolIcon } from "@/design/icons/ProtocolIcon";
import { Card } from "@/design/ui";
import type { ProtocolId } from "@/design/data/protocols";

/**
 * Board 9c — the ◔ popover. Alerts are grouped by connection because they
 * arrive across every open tab; the sidebar's 告警 page only rules this one.
 */
export function NotificationCenter({
  open,
  onClose,
}: {
  open: boolean;
  onClose?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose?.();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div ref={ref} style={{ position: "absolute", top: "36px", right: "58px", zIndex: 40 }}>
      <Card
        style={{
          width: "400px",
          overflow: "hidden",
          boxShadow: "0 18px 50px rgba(0,0,0,.18)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "13px 16px",
            borderBottom: "1px solid #ebebeb",
          }}
        >
          <b style={{ fontSize: "13px" }}>通知</b>
          <span className="st err" style={{ fontSize: "10px", marginLeft: "8px" }}>
            2 未读
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: "11.5px", color: "#29915d" }}>全部已读</span>
        </div>

        <GroupLabel protocol="rocketmq" name="rocketmq-order" />
        <Item
          dot="#d97706"
          title={
            <>
              <b style={{ fontWeight: 500 }}>order-settle 堆积超阈值</b>{" "}
              <span className="mono3" style={{ color: "#b45309" }}>
                982
              </span>
            </>
          }
          meta="阈值 500 · 持续 18 分钟 · 10:24"
          chevron
        />
        <Item
          dot="#d97706"
          title={<b style={{ fontWeight: 500 }}>broker-b 磁盘水位 87%</b>}
          meta="阈值 85% · 09:58"
          chevron
        />

        <GroupLabel protocol="kafka" name="prod-kafka-cn" />
        <Item
          dot="#a3a3a3"
          dim
          title="orders.created 出现 2 个未同步副本（已恢复）"
          meta="10:12 – 10:15"
        />

        <div style={{ display: "flex", alignItems: "center", padding: "11px 16px" }}>
          <span style={{ fontSize: "11px", color: "#8a8a8a" }}>桌面通知已开启</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: "11.5px", color: "#29915d" }}>告警规则设置 →</span>
        </div>
      </Card>
    </div>
  );
}

function GroupLabel({ protocol, name }: { protocol: ProtocolId; name: string }) {
  return (
    <div
      style={{
        padding: "10px 16px 4px",
        display: "flex",
        alignItems: "center",
        gap: "6px",
        fontSize: "10.5px",
        color: "#8a8a8a",
      }}
    >
      <ProtocolIcon protocol={protocol} size={12} />
      {name}
    </div>
  );
}

function Item({
  dot,
  title,
  meta,
  chevron,
  dim,
}: {
  dot: string;
  title: ReactNode;
  meta: string;
  chevron?: boolean;
  dim?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: "10px",
        padding: "8px 16px",
        borderBottom: "1px solid #f4f4f4",
        opacity: dim ? 0.6 : undefined,
      }}
    >
      <span className="dotg" style={{ background: dot, marginTop: "5px" }} />
      <div style={{ flex: 1, fontSize: "12px" }}>
        {title}
        <div style={{ fontSize: "10.5px", color: "#8a8a8a", marginTop: "1px" }}>{meta}</div>
      </div>
      {chevron && <span style={{ color: "#c9c9c9", alignSelf: "center" }}>›</span>}
    </div>
  );
}
