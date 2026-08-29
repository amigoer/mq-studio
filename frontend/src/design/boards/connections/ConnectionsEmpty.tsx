import { Plus } from "lucide-react";
import { AppLogo } from "@/design/icons/AppLogo";
import { ProtocolIcon } from "@/design/icons/ProtocolIcon";
import { Btn } from "@/design/ui";
import { PROTOCOLS, PROTOCOL_ORDER } from "@/design/data/protocols";

/** Board 8b — first launch, or after the last connection is deleted. */
export function ConnectionsEmpty({ onNewConnection }: { onNewConnection?: () => void }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 0,
          maxWidth: "440px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: "64px",
            height: "64px",
            borderRadius: "16px",
            background: "#fff",
            border: "1.5px solid #ebebeb",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <AppLogo width={40} height={27} />
        </div>
        <div style={{ fontSize: "19px", fontWeight: 600, marginTop: "18px", letterSpacing: "-.01em" }}>
          欢迎使用 MQ Studio
        </div>
        <div style={{ fontSize: "12.5px", color: "#8a8a8a", marginTop: "6px", lineHeight: 1.7 }}>
          还没有任何连接。新建一个连接开始管理你的消息队列，
          <br />
          或导入之前导出的配置文件。
        </div>
        <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
          <Btn variant="primary" style={{ padding: "6px 16px" }} onClick={onNewConnection}>
            <Plus size={13} aria-hidden />
              新建连接
          </Btn>
          <Btn style={{ padding: "6px 16px" }}>导入配置</Btn>
        </div>
        <div style={{ display: "flex", gap: "18px", marginTop: "34px", alignItems: "center" }}>
          {PROTOCOL_ORDER.map((p) => (
            <span
              key={p}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "5px",
                fontSize: "10px",
                color: "#8a8a8a",
              }}
            >
              <ProtocolIcon protocol={p} size={20} className="" />
              {PROTOCOLS[p].name}
            </span>
          ))}
        </div>
        <div style={{ fontSize: "10.5px", color: "#b5b1aa", marginTop: "26px" }}>
          凭证加密存储在本机 · 配置不会上传
        </div>
      </div>
    </div>
  );
}
