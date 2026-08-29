import { useState, type ReactNode } from "react";
import { Page, PageHeader, Toolbar, StatusBar } from "@/design/shell";
import {
  Btn,
  EnvTag,
  Field,
  Menu,
  MenuItem,
  MenuSeparator,
  SelectField,
  Status,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/design/ui";
import { ProtocolIcon } from "@/design/icons/ProtocolIcon";
import { CONNECTIONS, type Connection } from "@/design/data/connections";
import { PROTOCOL_ORDER, type ProtocolId } from "@/design/data/protocols";

/**
 * Board 8a — the global connection list. Row actions appear on hover; the `⋯`
 * menu carries the low-frequency operations so the row stays scannable.
 */
export function ConnectionsList({
  connections = CONNECTIONS,
  onNewConnection,
  onOpenTab,
  onDelete,
}: {
  connections?: readonly Connection[];
  onNewConnection?: () => void;
  onOpenTab?: (key: string) => void;
  onDelete?: (key: string) => void;
}) {
  const [filter, setFilter] = useState<ProtocolId | "all">("all");
  const [query, setQuery] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const rows = connections.filter(
    (c) =>
      (filter === "all" || c.protocol === filter) &&
      (query === "" || c.name.toLowerCase().includes(query.toLowerCase())),
  );

  const online = connections.filter((c) => c.status === "online").length;
  const failed = connections.filter((c) => c.status === "failed").length;

  return (
    <Page>
      <PageHeader
        title="连接"
        subtitle="全局视图：标题栏 ⇄ 或标签条 ＋ 进入 · 凭证加密存储在本机 · 双击行在新标签打开"
        actions={
          <>
            <Btn>导入</Btn>
            <Btn>导出</Btn>
            <Btn variant="primary" onClick={onNewConnection}>
              + 新建连接
            </Btn>
          </>
        }
      />

      <Toolbar>
        <Field
          style={{ flex: "0 0 200px" }}
          placeholder="搜索连接…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Chip active={filter === "all"} onClick={() => setFilter("all")}>
          全部 {connections.length}
        </Chip>
        {PROTOCOL_ORDER.map((p) => (
          <Chip key={p} active={filter === p} onClick={() => setFilter(p)}>
            <ProtocolIcon protocol={p} />
            {connections.filter((c) => c.protocol === p).length}
          </Chip>
        ))}
        <span style={{ flex: 1 }} />
        <SelectField value="全部环境" />
        <SelectField value="按最近使用" />
      </Toolbar>

      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }} className="mqs-scroll">
        <Table>
          <THead>
            <TR>
              <TH>名称</TH>
              <TH>协议</TH>
              <TH>地址</TH>
              <TH>环境</TH>
              <TH>状态</TH>
              <TH>最近使用</TH>
              <TH style={{ textAlign: "right" }}>操作</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((c) => (
              <TR key={c.key} onDoubleClick={() => onOpenTab?.(c.key)}>
                <TD>
                  <b style={{ fontWeight: 500 }}>{c.name}</b>{" "}
                  {c.isDefault && (
                    <span title="默认连接" style={{ color: "#d97706" }}>
                      ★
                    </span>
                  )}
                </TD>
                <TD>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <ProtocolIcon protocol={c.protocol} />
                    {c.protocolLabel}
                  </span>
                </TD>
                <TD className="mono3" style={{ color: "#666", fontSize: "11px" }}>
                  {c.address}
                </TD>
                <TD>
                  <EnvTag>{c.env}</EnvTag>
                </TD>
                <TD>
                  <StatusCell connection={c} />
                </TD>
                <TD style={{ color: "#8a8a8a" }}>{c.lastUsed}</TD>
                <TD style={{ textAlign: "right", overflow: "visible", position: "relative" }}>
                  <span className="mqs-rowhint">悬停显示操作 ⋯</span>
                  <span
                    className="mqs-rowactions"
                    style={{ position: "relative", display: "inline-flex", gap: "6px" }}
                  >
                    <RowActions connection={c} onOpenTab={onOpenTab} />
                    <Btn
                      size="rowIcon"
                      variant={menuFor === c.key ? "primary" : "default"}
                      aria-label="更多操作"
                      onClick={() => setMenuFor(menuFor === c.key ? null : c.key)}
                    >
                      ⋯
                    </Btn>
                    <Menu open={menuFor === c.key} onClose={() => setMenuFor(null)}>
                      <MenuItem active>复制连接</MenuItem>
                      <MenuItem>设为默认 ★</MenuItem>
                      <MenuItem>导出此连接</MenuItem>
                      <MenuItem>测试连接</MenuItem>
                      <MenuItem>操作日志</MenuItem>
                      <MenuSeparator />
                      <MenuItem
                        danger
                        onSelect={() => {
                          setMenuFor(null);
                          onDelete?.(c.key);
                        }}
                      >
                        删除连接…
                      </MenuItem>
                    </Menu>
                  </span>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>

      <StatusBar
        left={
          <span>
            {connections.length} 个连接 · {online} 在线 · {failed} 失败
          </span>
        }
        right={<span>★ 默认连接随应用启动自动连接</span>}
      />
    </Page>
  );
}

function StatusCell({ connection }: { connection: Connection }) {
  if (connection.status === "online") {
    return (
      <>
        <Status tone="ok" dot>
          在线
        </Status>{" "}
        <span className="mono3" style={{ fontSize: "10px", color: "#8a8a8a" }}>
          {connection.latency}
        </span>
      </>
    );
  }
  if (connection.status === "offline") return <Status tone="off">离线</Status>;
  return (
    <>
      <Status tone="err">连接失败</Status>{" "}
      <span style={{ fontSize: "10.5px", color: "#29915d" }}>日志</span>
    </>
  );
}

function RowActions({
  connection,
  onOpenTab,
}: {
  connection: Connection;
  onOpenTab?: (key: string) => void;
}) {
  if (connection.status === "online") {
    return (
      <>
        <Btn size="row" onClick={() => onOpenTab?.(connection.key)}>
          打开标签
        </Btn>
        <Btn size="row">断开</Btn>
        <Btn size="row">编辑</Btn>
      </>
    );
  }
  if (connection.status === "offline") {
    return (
      <>
        <Btn size="row" variant="primary">
          连接
        </Btn>
        <Btn size="row">编辑</Btn>
      </>
    );
  }
  return (
    <>
      <Btn size="row">重试</Btn>
      <Btn size="row">编辑</Btn>
    </>
  );
}

/** The protocol filter chip row (8a toolbar). */
function Chip({
  active,
  children,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="mqs-chip"
      aria-pressed={active}
      onClick={onClick}
      style={
        active
          ? {
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              border: "1px solid #171717",
              background: "#fafafa",
              fontWeight: 500,
              borderRadius: "99px",
              padding: "3px 10px",
              fontSize: "11px",
              color: "#171717",
            }
          : {
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              border: "1px solid #ebebeb",
              background: "#fff",
              borderRadius: "99px",
              padding: "3px 10px",
              fontSize: "11px",
              color: "#666",
            }
      }
    >
      {children}
    </button>
  );
}
